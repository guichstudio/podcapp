import AVFoundation
import SwiftUI
import UIKit

// The mini bar and the full player are two views of one AVPlayer, so the state
// cannot live in either of them. One shared object owns the playback; the views
// only read it.

// MARK: - Playback

/// A chapter placed on the timeline. The API sends title, text and sources but
/// no timings, so `start` and `duration` are derived here (see `timed`).
struct PlayerChapter: Identifiable {
    let id: Int
    let title: String
    let text: String
    let sources: [ChapterSource]
    /// Ids the chapter cites. Larger than `sources` when a cited source has been
    /// deleted since: the gap is shown rather than hidden.
    let citedCount: Int
    let grounding: [GroundingEntry]
    let start: Double
    let duration: Double

    var end: Double { start + duration }
    var correctedCount: Int { grounding.filter { $0.wasCorrected }.count }
}

enum PlayerSheet: String, Identifiable {
    case chapters, sources, transcript, backstage

    var id: String { rawValue }

    var title: String {
        switch self {
        case .chapters: return "Chapitres"
        case .sources: return "D’où ça vient"
        case .transcript: return "Transcription"
        case .backstage: return "Comment c’est fabriqué"
        }
    }
}

final class EpisodePlayer: ObservableObject {
    static let shared = EpisodePlayer()

    @Published private(set) var episode: EpisodeDetail?
    @Published private(set) var chapters: [PlayerChapter] = []
    @Published private(set) var time: Double = 0
    @Published private(set) var duration: Double = 0
    @Published private(set) var isPlaying = false
    @Published private(set) var speed: Double = 1
    @Published private(set) var isLoading = false
    /// Why the episode could not be fetched, in the API layer's own words.
    @Published private(set) var loadError: String?
    /// Why the audio will not play: not published yet, or AVFoundation refused it.
    @Published private(set) var playbackError: String?
    @Published var isPresented = false
    @Published var sheet: PlayerSheet?

    private static let speeds: [Double] = [1, 1.2, 1.5, 2]

    private let player = AVPlayer()
    private var timeObserver: Any?
    private var statusObserver: NSKeyValueObservation?
    private var transportObserver: NSKeyValueObservation?
    private var endObserver: NSObjectProtocol?
    private var sessionReady = false
    /// A chapter asked for before the timeline was known, replayed once it is.
    private var pendingChapter: Int?
    /// Last chapter the narration was heard in, so a boundary crossing can be
    /// told apart from a seek. -1 until the first tick of a fresh player.
    private var lastChapter = -1

    private init() {
        // 0.25 s is the design's own tick: fast enough for the seek bar, cheap
        // enough to run for a fifteen minute episode.
        let interval = CMTime(seconds: 0.25, preferredTimescale: 600)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] current in
            guard let self else { return }
            self.time = max(0, current.seconds)
            if self.duration <= 0 { self.refreshDuration() }
            self.noticeChapterTurn()
        }
        // The system pauses the player on its own (phone call, Siri, headphones
        // unplugged): the UI must follow the player, not the last button tap,
        // or the pause glyph animates over silence.
        transportObserver = player.observe(\.timeControlStatus, options: [.new]) { [weak self] observed, _ in
            let playing = observed.timeControlStatus != .paused
            DispatchQueue.main.async {
                guard let self, self.isPlaying != playing else { return }
                self.isPlaying = playing
            }
        }
    }

    deinit {
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    }

    var currentIndex: Int {
        guard !chapters.isEmpty else { return 0 }
        // Walking backwards means the boundary belongs to the chapter it opens.
        for chapter in chapters.reversed() where time >= chapter.start { return chapter.id }
        return 0
    }

    /// The only feedback the app gives without being touched, so it fires on
    /// one case and no other: the audio itself crossing into the next chapter
    /// while it plays. A seek that lands elsewhere is the user's own doing and
    /// was already felt under their thumb.
    private func noticeChapterTurn() {
        let index = currentIndex
        guard lastChapter != index else { return }
        let previous = lastChapter
        lastChapter = index
        guard isPlaying, previous >= 0, index == previous + 1 else { return }
        Feedback.chapterTurned()
    }

    var currentChapter: PlayerChapter? {
        chapters.indices.contains(currentIndex) ? chapters[currentIndex] : nil
    }

    var progress: Double { duration > 0 ? min(1, max(0, time / duration)) : 0 }

    // MARK: Opening

    /// Fetches the episode, then plays it. Used from a list that only holds ids.
    func open(episodeId: String, startAt: Double? = nil) {
        isPresented = true
        isLoading = true
        loadError = nil
        Task { @MainActor in
            do {
                let detail = try await API.shared.episode(id: episodeId)
                self.open(detail, startAt: startAt)
            } catch {
                self.isLoading = false
                self.loadError = error.localizedDescription
            }
        }
    }

    /// The contract the Read tab needs: it holds a chapter index, not a
    /// timecode, because the script carries no timings. Turning one into the
    /// other is this object's job, since it alone knows the timeline.
    func open(_ episode: EpisodeDetail, chapterIndex: Int) {
        open(episode)
        jump(toChapter: chapterIndex)
    }

    func jump(toChapter index: Int) {
        guard chapters.indices.contains(index) else { return }
        // An episode with no recorded length has a flat timeline until the mp3
        // header lands, so the seek waits for it rather than landing on zero.
        if duration <= 0 {
            pendingChapter = index
            return
        }
        seek(to: chapters[index].start)
        play()
    }

    func open(_ episode: EpisodeDetail, startAt: Double? = nil) {
        isPresented = true
        isLoading = false
        loadError = nil
        pendingChapter = nil

        // Same episode again: keep the position instead of restarting it. A
        // failed item is not kept: replaying it would pretend to play silence,
        // so it falls through and gets rebuilt from the fresh URL.
        if self.episode?.id == episode.id, let current = player.currentItem, current.status != .failed {
            if let startAt { seek(to: startAt) }
            play()
            return
        }

        self.episode = episode
        self.time = 0
        self.duration = Double(episode.actualSec ?? 0)
        self.chapters = Self.timed(episode.chapters, total: self.duration)

        guard let url = episode.audioURL else {
            // A queued or failed episode has no mp3. Say which, do not spin.
            teardownItem()
            playbackError = "Pas encore d’audio pour cet épisode (\(Self.frenchStatus(episode.status)))."
            isPlaying = false
            return
        }

        playbackError = nil
        // The mp3 never changes once published (the row goes ready exactly
        // once), and AVPlayer bypasses URLCache: play the cached copy when one
        // exists, and fill the cache in the background otherwise.
        let cached = Self.cachedAudio(for: episode.id)
        if cached == nil { Self.cacheAudio(episodeId: episode.id, from: url) }
        let item = AVPlayerItem(url: cached ?? url)
        statusObserver = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            DispatchQueue.main.async { self?.itemStatusChanged(item) }
        }
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            self?.isPlaying = false
        }
        player.replaceCurrentItem(with: item)
        if let startAt { seek(to: startAt) }
        play()
    }

    // MARK: Transport

    /// False when there is no mp3 behind the screen: the transport must not
    /// pretend to move a playhead over silence.
    var isPlayable: Bool { episode?.audioURL != nil && playbackError == nil }

    func play() {
        guard player.currentItem != nil else { return }
        activateSession()
        // AVPlayer sitting on the last frame ignores play(), so the button would
        // do nothing at the end of a briefing.
        if duration > 0, time >= duration - 0.25 { seek(to: 0) }
        player.play()
        player.rate = Float(speed)
        isPlaying = true
    }

    func pause() {
        player.pause()
        isPlaying = false
    }

    func toggle() { isPlaying ? pause() : play() }

    func seek(to seconds: Double) {
        guard player.currentItem != nil else { return }
        let target = min(max(0, seconds), duration > 0 ? duration : seconds)
        time = target
        player.seek(
            to: CMTime(seconds: target, preferredTimescale: 600),
            toleranceBefore: .zero,
            toleranceAfter: .zero
        )
    }

    func skip(_ delta: Double) { seek(to: time + delta) }

    /// Restarts the chapter unless it just started, which is the podcast habit.
    func previousChapter() {
        guard let current = currentChapter else { return }
        if time - current.start > 3 {
            seek(to: current.start)
        } else {
            seek(to: chapters.indices.contains(current.id - 1) ? chapters[current.id - 1].start : 0)
        }
    }

    func nextChapter() {
        let next = currentIndex + 1
        guard chapters.indices.contains(next) else { return }
        seek(to: chapters[next].start)
    }

    func cycleSpeed() {
        let index = Self.speeds.firstIndex(of: speed) ?? 0
        speed = Self.speeds[(index + 1) % Self.speeds.count]
        if isPlaying { player.rate = Float(speed) }
    }

    var speedLabel: String {
        // French writes 1,2 and this label sits next to French controls.
        let text = speed == speed.rounded() ? String(Int(speed)) : String(speed).replacingOccurrences(of: ".", with: ",")
        return text + "×"
    }

    // MARK: Internals

    private static func audioCacheURL(for episodeId: String) -> URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("episode-\(episodeId).mp3")
    }

    private static func cachedAudio(for episodeId: String) -> URL? {
        let url = audioCacheURL(for: episodeId)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    /// Ids with a download in flight, so replaying while one runs does not
    /// start a second. Main-actor confined, like every caller.
    private static var cachingIds = Set<String>()

    private static func cacheAudio(episodeId: String, from remote: URL) {
        guard !cachingIds.contains(episodeId) else { return }
        cachingIds.insert(episodeId)
        URLSession.shared.downloadTask(with: remote) { tmp, response, _ in
            let ok = (response as? HTTPURLResponse)?.statusCode == 200
            if ok, let tmp {
                // moveItem fails if the file landed meanwhile, which is fine.
                try? FileManager.default.moveItem(at: tmp, to: audioCacheURL(for: episodeId))
            }
            DispatchQueue.main.async { cachingIds.remove(episodeId) }
        }.resume()
    }

    private func teardownItem() {
        statusObserver = nil
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
        player.replaceCurrentItem(with: nil)
    }

    private func itemStatusChanged(_ item: AVPlayerItem) {
        switch item.status {
        case .failed:
            pause()
            playbackError = item.error?.localizedDescription ?? "Lecture impossible : fichier audio illisible."
        case .readyToPlay:
            playbackError = nil
            refreshDuration()
        default:
            break
        }
    }

    /// The mp3 is streamed, so its real length only arrives once the header is
    /// read. `actualSec` carries the timeline until then.
    private func refreshDuration() {
        guard let item = player.currentItem else { return }
        let seconds = item.duration.seconds
        guard seconds.isFinite, seconds > 0, abs(seconds - duration) > 0.5 else { return }
        duration = seconds
        if let episode { chapters = Self.timed(episode.chapters, total: seconds) }
        if let pendingChapter {
            self.pendingChapter = nil
            jump(toChapter: pendingChapter)
        }
    }

    private func activateSession() {
        // Without .playback the briefing goes silent on a phone set to ring/silent.
        if !sessionReady {
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
            sessionReady = true
        }
        // Reactivated on every play: a phone call deactivates the session, and
        // the resume afterwards has to claim it back.
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    /// The pipeline records no per chapter timing, so the timeline is split by
    /// script length: the narration runs at one steady rate, which makes the
    /// character count of a chapter proportional to its airtime.
    private static func timed(_ chapters: [EpisodeChapter], total: Double) -> [PlayerChapter] {
        let weights = chapters.map { Double(max(1, $0.text.count)) }
        let sum = weights.reduce(0, +)
        var start: Double = 0
        return chapters.enumerated().map { index, chapter in
            let span = sum > 0 ? total * weights[index] / sum : 0
            defer { start += span }
            return PlayerChapter(
                id: index,
                title: chapter.title,
                text: chapter.text,
                sources: chapter.sources,
                citedCount: chapter.sourceIds.count,
                grounding: chapter.grounding,
                start: start,
                duration: span
            )
        }
    }

    static func frenchStatus(_ status: String) -> String {
        switch status {
        case "ready": return "prêt"
        case "queued": return "en file"
        case "editing": return "en écriture"
        case "tts": return "en narration"
        case "assembling": return "en assemblage"
        case "failed": return "échec"
        default: return status
        }
    }
}

// MARK: - Mini bar

/// The bar that sits above the tab bar. It also carries the full screen player,
/// so a screen that shows it can open the player from anywhere.
struct MiniPlayerBar: View {
    @ObservedObject private var player = EpisodePlayer.shared

    var body: some View {
        Group {
            if player.episode != nil && !player.isPresented {
                bar
            } else {
                // Zero height rather than nothing: the cover below has to stay
                // attached even when there is no bar to show.
                Color.clear.frame(height: 0)
            }
        }
        .fullScreenCover(isPresented: $player.isPresented) { PlayerView() }
    }

    private var bar: some View {
        HStack(spacing: 11) {
            PlayerArtwork(size: 34, radius: 9)
            VStack(alignment: .leading, spacing: 1) {
                Text(player.currentChapter?.title ?? player.episode?.title ?? "Briefing")
                    .typo(Typo.buttonMedium)
                    .foregroundStyle(Palette.onDark)
                    .lineLimit(1)
                Text("\(PlayerFormat.time(player.time)) / \(PlayerFormat.time(player.duration))")
                    .typo(TypoStyle(size: 10.5, weight: .regular, monospacedDigits: true))
                    .foregroundStyle(Palette.onDark.opacity(0.65))
            }
            // flex:1 in the markup: without it the HStack shrinks to its text
            // and the bar floats as a pill instead of spanning the screen.
            .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                player.toggle()
                player.isPlaying ? Feedback.play() : Feedback.pause()
            } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Palette.onDark)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(player.isPlaying ? "Pause" : "Lecture")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(alignment: .bottomLeading) {
            ZStack(alignment: .bottomLeading) {
                LinearGradient(
                    colors: [Color(hex: 0x5B4DBE, opacity: 0.95), Color(hex: 0x3A3087, opacity: 0.95)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                GeometryReader { geo in
                    Rectangle()
                        .fill(Palette.onDark)
                        .frame(width: geo.size.width * player.progress, height: 2)
                        .frame(maxHeight: .infinity, alignment: .bottom)
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 15, style: .continuous)
                .strokeBorder(Palette.onDark.opacity(0.22), lineWidth: 1)
        )
        .shadow(color: Color(hex: 0x322A6E, opacity: 0.3), radius: 15, y: 12)
        .padding(.horizontal, 10)
        .padding(.bottom, 6)
        .contentShape(Rectangle())
        .onTapGesture { player.isPresented = true }
    }
}

// MARK: - Full player

struct PlayerView: View {
    @ObservedObject private var player = EpisodePlayer.shared
    /// Set while a finger is on the seek bar, so the labels follow the finger
    /// and not the still-playing clock.
    @State private var scrub: Double?

    var body: some View {
        ZStack {
            PlayerPalette.background.ignoresSafeArea()
            content
        }
        .sheet(item: $player.sheet) { sheet in
            PlayerSheetView(sheet: sheet)
        }
    }

    @ViewBuilder
    private var content: some View {
        VStack(spacing: 0) {
            header
            if player.isLoading {
                PlayerNotice(
                    title: "Chargement du briefing",
                    detail: nil,
                    kind: .neutral,
                    showsSpinner: true
                )
            } else if let loadError = player.loadError {
                PlayerNotice(
                    title: "Impossible de charger l’épisode",
                    detail: loadError,
                    kind: .danger,
                    showsSpinner: false
                )
            } else if player.episode == nil {
                PlayerNotice(
                    title: "Aucun épisode en lecture",
                    detail: "Ouvrez un briefing depuis l’onglet Aujourd’hui pour l’écouter ici.",
                    kind: .neutral,
                    showsSpinner: false
                )
            } else {
                transport
                sourceButton
            }
        }
    }

    private var header: some View {
        HStack {
            Button {
                player.isPresented = false
            } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Palette.body)
                    .padding(8)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Fermer le lecteur")

            Spacer()
            Overline(text: overline, color: Palette.accentMuted)
            Spacer()

            Button {
                player.sheet = .backstage
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Palette.body)
                    .padding(8)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Comment c’est fabriqué")
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    private var overline: String {
        guard let episode = player.episode else { return "Briefing" }
        return "Briefing · " + PlayerFormat.day(episode.createdAt)
    }

    private var transport: some View {
        VStack(spacing: 18) {
            Spacer(minLength: 0)

            ZStack(alignment: .bottomTrailing) {
                PlayerArtwork(size: 122, radius: 28)
                    .shadow(color: Color(hex: 0x322A6E, opacity: 0.22), radius: 30, y: 24)
                if player.isPlaying {
                    PlayingBars()
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                        .background(Palette.ink.opacity(0.92), in: Capsule())
                        .offset(x: 6, y: 6)
                }
            }

            VStack(spacing: 7) {
                Text(chapterOverline)
                    .typo(TypoStyle(size: 11, weight: .semibold, trackingEm: 0.13))
                    .foregroundStyle(Palette.accentMuted)
                Text(player.currentChapter?.title ?? player.episode?.title ?? "Briefing")
                    .typo(Typo.playerTitle)
                    .foregroundStyle(Palette.ink)
                    .multilineTextAlignment(.center)
            }

            if let playbackError = player.playbackError {
                Text(playbackError)
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.danger)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 9)
                    .frame(maxWidth: .infinity)
                    .background(Palette.dangerBg, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }

            seekBar
            controls
            pills

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 28)
        .frame(maxHeight: .infinity)
    }

    private var chapterOverline: String {
        guard let current = player.currentChapter else { return "Briefing" }
        return PlayerSourceText.position(current, in: player.chapters)
    }

    private var displayTime: Double { scrub ?? player.time }

    private var seekBar: some View {
        VStack(spacing: 4) {
            GeometryReader { geo in
                let width = geo.size.width
                let ratio = player.duration > 0 ? min(1, max(0, displayTime / player.duration)) : 0
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Palette.ink.opacity(0.14))
                        .frame(height: 4)
                    Capsule()
                        .fill(Palette.ink)
                        .frame(width: width * ratio, height: 4)
                    ForEach(player.chapters.dropFirst()) { chapter in
                        if player.duration > 0 {
                            RoundedRectangle(cornerRadius: 2, style: .continuous)
                                .fill(PlayerPalette.tick)
                                .frame(width: 2, height: 8)
                                .offset(x: width * (chapter.start / player.duration) - 1)
                        }
                    }
                }
                .frame(height: 26)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            guard player.duration > 0, width > 0 else { return }
                            scrub = min(max(0, value.location.x / width), 1) * player.duration
                        }
                        .onEnded { _ in
                            if let scrub { player.seek(to: scrub) }
                            scrub = nil
                        }
                )
            }
            .frame(height: 26)

            HStack {
                Text(PlayerFormat.time(displayTime))
                Spacer()
                Text("-" + PlayerFormat.time(max(0, player.duration - displayTime)))
            }
            .typo(Typo.metaTiny.tabular)
            .foregroundStyle(Palette.accentMuted)
        }
        .frame(maxWidth: 340)
        .disabled(!player.isPlayable || player.duration <= 0)
    }

    private var controls: some View {
        HStack(spacing: 10) {
            Button { player.previousChapter() } label: {
                Image(systemName: "backward.end.fill")
                    .font(.system(size: 17))
                    .foregroundStyle(Palette.ink)
                    .padding(12)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Chapitre précédent")

            PlayerSkipButton(label: "-15") { Feedback.tap(); player.skip(-15) }

            Button {
                player.toggle()
                player.isPlaying ? Feedback.play() : Feedback.pause()
            } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 24, weight: .medium))
                    .foregroundStyle(Palette.onDark)
                    .frame(width: 68, height: 68)
                    .background(Palette.ink, in: Circle())
                    .shadow(color: Palette.ink.opacity(0.28), radius: 17, y: 14)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(player.isPlaying ? "Pause" : "Lecture")

            PlayerSkipButton(label: "+15") { Feedback.tap(); player.skip(15) }

            Button { player.nextChapter() } label: {
                Image(systemName: "forward.end.fill")
                    .font(.system(size: 17))
                    .foregroundStyle(Palette.ink)
                    .padding(12)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Chapitre suivant")
        }
        .disabled(!player.isPlayable)
        .opacity(player.isPlayable ? 1 : 0.4)
    }

    private var pills: some View {
        HStack(spacing: 8) {
            PlayerPill(label: player.speedLabel) { player.cycleSpeed() }
            PlayerPill(label: "Chapitres") { player.sheet = .chapters }
            PlayerPill(label: "Transcription") { player.sheet = .transcript }
        }
    }

    private var sourceButton: some View {
        Button {
            player.sheet = .sources
        } label: {
            HStack(spacing: 11) {
                Text("Source")
                    .textCase(.uppercase)
                    .typo(TypoStyle(size: 10, weight: .semibold, trackingEm: 0.1))
                    .foregroundStyle(Palette.accentMuted)
                Text(sourceLine)
                    .typo(TypoStyle(size: 12.5, weight: .regular))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Palette.muted2)
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 13)
            .background(Color.white.opacity(0.8), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .strokeBorder(Color(hex: 0x1C1B22, opacity: 0.09), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .padding(.bottom, 14)
    }

    private var sourceLine: String {
        guard let current = player.currentChapter else { return "Aucune source" }
        guard let first = current.sources.first else {
            return "Éditorial : intro/outro, sans faits externes"
        }
        let name = PlayerSourceText.publisher(first)
        let extra = current.sources.count > 1 ? " +\(current.sources.count - 1)" : ""
        return name + " : " + PlayerSourceText.title(first) + extra
    }
}

// MARK: - Sheets

private struct PlayerSheetView: View {
    let sheet: PlayerSheet
    @ObservedObject private var player = EpisodePlayer.shared

    init(sheet: PlayerSheet) { self.sheet = sheet }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(sheet.title)
                    .typo(Typo.sectionTitle)
                    .foregroundStyle(Palette.ink)
                Spacer()
                Button("Fermer") { player.sheet = nil }
                    .typo(Typo.navButton)
                    .foregroundStyle(Palette.muted)
                    .buttonStyle(.plain)
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 10)

            Divider().overlay(Palette.hairline)

            ScrollView {
                Group {
                    switch sheet {
                    case .chapters: PlayerChaptersSheet()
                    case .sources: PlayerSourcesSheet()
                    case .transcript: PlayerTranscriptSheet()
                    case .backstage: PlayerBackstageSheet()
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 14)
                .padding(.bottom, 30)
            }
        }
        .presentationDetents([.fraction(0.76)])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(24)
        .presentationBackground(Color(hex: 0xFCFCFA, opacity: 0.94))
    }
}

private struct PlayerChaptersSheet: View {
    @ObservedObject private var player = EpisodePlayer.shared

    var body: some View {
        if player.chapters.isEmpty {
            PlayerEmptyLine(text: "Cet épisode n’a pas encore de chapitres.")
        } else {
            VStack(spacing: 0) {
                ForEach(player.chapters) { chapter in
                    let isCurrent = chapter.id == player.currentIndex
                    Button {
                        player.seek(to: chapter.start)
                        player.play()
                        player.sheet = nil
                    } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 13) {
                            Text(String(format: "%02d", chapter.id))
                                .typo(Typo.buttonSmall.tabular)
                                .foregroundStyle(isCurrent ? Palette.ink : Palette.fainter)
                                .frame(width: 20, alignment: .leading)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(chapter.title)
                                    .typo(isCurrent ? Typo.rowTitleStrong : Typo.rowTitle)
                                    .foregroundStyle(Palette.ink)
                                    .multilineTextAlignment(.leading)
                                Text(PlayerSourceText.chapterSubtitle(chapter, in: player.chapters))
                                    .typo(Typo.metaSmall)
                                    .foregroundStyle(Palette.muted)
                                    .multilineTextAlignment(.leading)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            Text(PlayerFormat.time(chapter.duration))
                                .typo(Typo.meta.tabular)
                                .foregroundStyle(Palette.muted)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 13)
                        .background(
                            isCurrent ? Palette.airedChipBg : Color.clear,
                            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                        )
                    }
                    .buttonStyle(.plain)
                    Divider().overlay(Palette.hairline)
                }
            }
        }
    }
}

private struct PlayerSourcesSheet: View {
    @ObservedObject private var player = EpisodePlayer.shared

    static func verdictLine(_ chapter: PlayerChapter) -> String {
        let n = chapter.grounding.count
        let fixed = chapter.correctedCount
        let phrases = n == 1 ? "1 phrase a été confrontée" : "\(n) phrases ont été confrontées"
        if fixed == 0 { return "\(phrases) à ces sources avant diffusion. Aucune n’a dû être corrigée." }
        let corrected = fixed == 1 ? "1 a été réécrite" : "\(fixed) ont été réécrites"
        return "\(phrases) à ces sources avant diffusion. \(corrected) pour coller à la preuve."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let chapter = player.currentChapter {
                Overline(text: chapter.title)

                if chapter.sources.isEmpty {
                    Text("Intro/outro : aucun fait externe.")
                        .typo(TypoStyle(size: 13, weight: .regular, lineHeight: 1.5))
                        .foregroundStyle(Palette.muted)
                }

                ForEach(chapter.sources) { source in
                    PlayerSourceCard(source: source)
                }

                let missing = chapter.citedCount - chapter.sources.count
                if missing > 0 {
                    PlayerFlag(
                        label: "Écarté",
                        text: missing == 1
                            ? "1 source citée n’est plus dans votre bibliothèque : elle est signalée plutôt que reconstituée."
                            : "\(missing) sources citées ne sont plus dans votre bibliothèque : elles sont signalées plutôt que reconstituées."
                    )
                }

                if !chapter.grounding.isEmpty {
                    Overline(text: "Vérifié à l’antenne")
                        .padding(.top, 8)
                    Text(Self.verdictLine(chapter))
                        .typo(Typo.metaSmall)
                        .foregroundStyle(Palette.muted2)
                        .lineSpacing(3)

                    ForEach(chapter.grounding) { entry in
                        GroundedSentenceRow(entry: entry)
                    }
                } else if !chapter.sources.isEmpty {
                    // No entry at all means nothing in the chapter was checkable,
                    // which is not the same as nothing having been checked.
                    Overline(text: "Vérifié à l’antenne")
                        .padding(.top, 8)
                    Text("Aucune phrase de ce chapitre ne portait de chiffre, de citation ni de nom à vérifier.")
                        .typo(Typo.metaSmall)
                        .foregroundStyle(Palette.muted2)
                        .lineSpacing(3)
                }
            } else {
                PlayerEmptyLine(text: "Aucun chapitre en lecture.")
            }

            Button {
                player.sheet = .backstage
            } label: {
                Text("Comment cet épisode a été fabriqué →")
                    .typo(Typo.buttonMedium)
                    .foregroundStyle(Palette.body)
                    .frame(maxWidth: .infinity)
                    .padding(12)
                    .overlay(
                        RoundedRectangle(cornerRadius: 13, style: .continuous)
                            .strokeBorder(
                                Color(hex: 0x1C1B22, opacity: 0.22),
                                style: StrokeStyle(lineWidth: 1, dash: [4, 3])
                            )
                    )
            }
            .buttonStyle(.plain)
            .padding(.top, 10)
        }
    }
}

private struct PlayerSourceCard: View {
    let source: ChapterSource

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(PlayerSourceText.publisher(source))
                    .textCase(.uppercase)
                    .typo(Typo.sourcePub)
                    .foregroundStyle(Palette.body)
                Spacer()
                if let lang = source.lang, !lang.isEmpty {
                    Text(lang.uppercased())
                        .typo(Typo.metaTiny)
                        .foregroundStyle(Palette.muted2)
                }
            }
            Text(PlayerSourceText.title(source))
                .typo(Typo.rowTitle)
                .lineSpacing(4)
                .foregroundStyle(Palette.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let meta = PlayerSourceText.meta(source) {
                Text(meta)
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted2)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.7), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 15, style: .continuous)
                .strokeBorder(Color(hex: 0x1C1B22, opacity: 0.09), lineWidth: 1)
        )
    }
}

private struct PlayerTranscriptSheet: View {
    @ObservedObject private var player = EpisodePlayer.shared

    var body: some View {
        if let chapter = player.currentChapter, !chapter.text.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Overline(text: PlayerSourceText.position(chapter, in: player.chapters) + " · synchronisé")
                Text(chapter.text)
                    .typo(Typo.transcriptBody)
                    .foregroundStyle(Palette.prose)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Divider().overlay(Palette.hairline)
                Text("✓ vérifié : touchez SOURCE pour la preuve.")
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted2)
                    .padding(.top, 4)
            }
        } else {
            PlayerEmptyLine(text: "Pas de texte pour ce chapitre : l’épisode n’a pas encore de script lisible.")
        }
    }
}

private struct PlayerBackstageSheet: View {
    @ObservedObject private var player = EpisodePlayer.shared

    var body: some View {
        if let episode = player.episode {
            EpisodeBackstage(detail: episode)
        } else {
            PlayerEmptyLine(text: "Aucun épisode en lecture.")
        }
    }
}

struct PlayerStat: View {
    let value: Int
    let label: String

    var body: some View {
        VStack(spacing: 2) {
            Text("\(value)")
                .typo(Typo.statNumber)
                .foregroundStyle(Palette.ink)
            Text(label)
                .typo(TypoStyle(size: 10.5, weight: .regular))
                .foregroundStyle(Palette.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
    }
}

struct PlayerFlag: View {
    let label: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            StatusChip(label: label, kind: .danger)
            Text(text)
                .typo(TypoStyle(size: 12, weight: .regular, lineHeight: 1.45))
                .foregroundStyle(Palette.ink2)
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 11)
        .background(Palette.danger.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Palette.danger.opacity(0.2), lineWidth: 1)
        )
    }
}

private struct PlayerEmptyLine: View {
    let text: String

    var body: some View {
        Text(text)
            .typo(Typo.detail)
            .foregroundStyle(Palette.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct PlayerNotice: View {
    enum Kind { case neutral, danger }

    let title: String
    let detail: String?
    let kind: Kind
    let showsSpinner: Bool

    var body: some View {
        VStack(spacing: 12) {
            if showsSpinner { ProgressView().tint(Palette.accentDeep) }
            Text(title)
                .typo(Typo.cardTitle)
                .foregroundStyle(kind == .danger ? Palette.danger : Palette.ink)
                .multilineTextAlignment(.center)
            if let detail {
                Text(detail)
                    .typo(Typo.detail)
                    .foregroundStyle(Palette.muted)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct PlayerPill: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .typo(Typo.buttonSmall)
                .foregroundStyle(Palette.ink)
                .padding(.horizontal, 15)
                .padding(.vertical, 9)
                .background(Palette.ink.opacity(0.04), in: Capsule())
                .overlay(Capsule().strokeBorder(Palette.ink.opacity(0.12), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

private struct PlayerSkipButton: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .typo(Typo.metaTiny.tabular)
                .foregroundStyle(Palette.ink)
                .frame(width: 46, height: 46)
                .background(Palette.ink.opacity(0.05), in: Circle())
                .overlay(Circle().strokeBorder(Palette.ink.opacity(0.14), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label == "-15" ? "Reculer de 15 secondes" : "Avancer de 15 secondes")
    }
}

private struct PlayerArtwork: View {
    let size: CGFloat
    let radius: CGFloat

    var body: some View {
        Group {
            if let image = UIImage(named: "logo") ?? UIImage(named: "logo.png") {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                // A missing asset must still read as artwork, not as a hole.
                Palette.glassFill
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .strokeBorder(Color(hex: 0x1C1B22, opacity: 0.08), lineWidth: 1)
        )
    }
}

private struct PlayingBars: View {
    @State private var animating = false

    var body: some View {
        HStack(alignment: .bottom, spacing: 2.5) {
            ForEach(0..<3, id: \.self) { index in
                Capsule()
                    .fill(Palette.onDark)
                    .frame(width: 3, height: 11)
                    .scaleEffect(y: animating ? 1 : 0.35, anchor: .bottom)
                    .animation(
                        .easeInOut(duration: 0.45)
                            .repeatForever(autoreverses: true)
                            .delay(Double(index) * 0.25),
                        value: animating
                    )
            }
        }
        .frame(height: 11)
        .onAppear { animating = true }
    }
}

/// The pipeline chips wrap; SwiftUI has no flow container before iOS 16's Layout,
/// which this uses rather than guessing at row breaks.
struct PlayerFlowLayout: Layout {
    let spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        let rows = layout(subviews: subviews, width: width)
        let height = rows.last.map { $0.y + $0.height } ?? 0
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for row in layout(subviews: subviews, width: bounds.width) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(
                    at: CGPoint(x: x, y: bounds.minY + row.y),
                    proposal: ProposedViewSize(size)
                )
                x += size.width + spacing
            }
        }
    }

    private struct Row {
        var indices: [Int] = []
        var y: CGFloat = 0
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func layout(subviews: Subviews, width: CGFloat) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        var x: CGFloat = 0
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            if !row.indices.isEmpty, x + size.width > width {
                rows.append(row)
                row = Row(indices: [], y: row.y + row.height + spacing, width: 0, height: 0)
                x = 0
            }
            row.indices.append(index)
            x += size.width + spacing
            row.width = x - spacing
            row.height = max(row.height, size.height)
        }
        if !row.indices.isEmpty { rows.append(row) }
        return rows
    }
}

// MARK: - Formatting

private enum PlayerFormat {
    static func time(_ seconds: Double) -> String {
        guard seconds.isFinite else { return "0:00" }
        let total = max(0, Int(seconds.rounded()))
        return "\(total / 60):" + String(format: "%02d", total % 60)
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "fr_FR")
        formatter.setLocalizedDateFormatFromTemplate("d MMMM")
        return formatter
    }()

    static func day(_ date: Date) -> String { dayFormatter.string(from: date) }

    /// French writes 0,92 and the extraction quality is read as a score.
    static func quality(_ value: Double) -> String {
        String(format: "%.2f", value).replacingOccurrences(of: ".", with: ",")
    }
}

private enum PlayerSourceText {
    static func publisher(_ source: ChapterSource) -> String {
        if let publisher = source.publisher, !publisher.isEmpty { return publisher }
        if let host = source.link?.host { return host }
        return "Source"
    }

    static func title(_ source: ChapterSource) -> String {
        if let title = source.title, !title.isEmpty { return title }
        if let url = source.url, !url.isEmpty { return url }
        return "Titre inconnu"
    }

    static func meta(_ source: ChapterSource) -> String? {
        var parts: [String] = []
        if let quality = source.extractionQuality {
            parts.append("Qualité d’extraction " + PlayerFormat.quality(quality))
        }
        if let host = source.link?.host { parts.append(host) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// Where the chapter sits in the episode. Intro and outro carry no sources,
    /// so the numbering counts only the chapters that do, as the design does.
    static func position(_ chapter: PlayerChapter, in all: [PlayerChapter]) -> String {
        let sourced = all.filter { !$0.sources.isEmpty }
        if let rank = sourced.firstIndex(where: { $0.id == chapter.id }) {
            return "Chapitre \(rank + 1) sur \(sourced.count)"
        }
        if chapter.id == 0 { return "Intro" }
        if chapter.id == all.count - 1 { return "Outro" }
        return "Chapitre"
    }

    static func chapterSubtitle(_ chapter: PlayerChapter, in all: [PlayerChapter]) -> String {
        if !chapter.sources.isEmpty {
            let names = chapter.sources.map(publisher)
            return names.joined(separator: " · ")
        }
        if chapter.id == 0 { return "Intro" }
        if chapter.id == all.count - 1 { return "Outro" }
        return "Éditorial"
    }
}

private enum PlayerPalette {
    /// The player's own backdrop: linear-gradient(180deg, #E4DFF5, #F4F3EF 46%,
    /// #FAFAF8). Deeper at the top than the screen gradient in Theme.
    static let background = LinearGradient(
        stops: [
            .init(color: Color(hex: 0xE4DFF5), location: 0),
            .init(color: Color(hex: 0xF4F3EF), location: 0.46),
            .init(color: Color(hex: 0xFAFAF8), location: 1),
        ],
        startPoint: .top,
        endPoint: .bottom
    )

    /// Chapter marks on the seek bar, light enough to read over the dark fill.
    static let tick = Color(hex: 0xE9E5F5)
}


// One checked sentence and its verdict. A correction shows both versions: the
// point of the report is that the listener can see what the evidence changed.
private struct GroundedSentenceRow: View {
    let entry: GroundingEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                StatusChip(
                    // Feminine: the referent is "une phrase", like the sheet's
                    // own copy ("1 a été réécrite").
                    label: entry.wasCorrected ? "Corrigée" : "Vérifiée",
                    kind: entry.wasCorrected ? .warning : .success
                )
                Spacer(minLength: 0)
            }
            if entry.wasCorrected, let fix = entry.fix {
                Text(fix)
                    .typo(TypoStyle(size: 13, weight: .regular, lineHeight: 1.5))
                    .foregroundStyle(Palette.prose)
                Text(entry.sentence)
                    .typo(TypoStyle(size: 12, weight: .light, lineHeight: 1.45))
                    .foregroundStyle(Palette.muted2)
                    .strikethrough(true, color: Palette.muted2.opacity(0.6))
            } else {
                Text(entry.sentence)
                    .typo(TypoStyle(size: 13, weight: .regular, lineHeight: 1.5))
                    .foregroundStyle(Palette.prose)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.white.opacity(0.55))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color(hex: 0x1C1B22, opacity: 0.07))
        )
    }
}
