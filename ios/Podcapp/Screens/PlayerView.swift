import MediaPlayer
import UIKit
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
        case .chapters: return String(localized: "Chapters")
        case .sources: return String(localized: "Where it comes from")
        case .transcript: return String(localized: "Transcript")
        case .backstage: return String(localized: "How it was made")
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
        configureRemoteCommands()
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
        // The chapter title is what the lock screen shows.
        refreshNowPlaying()
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
        refreshNowPlaying()

        guard let url = episode.audioURL else {
            // A queued or failed episode has no mp3. Say which, do not spin.
            teardownItem()
            playbackError = String(localized: "No audio for this episode yet (\(Self.statusLabel(episode.status))).")
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
        refreshNowPlaying()
    }

    func pause() {
        player.pause()
        isPlaying = false
        refreshNowPlaying()
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
        refreshNowPlaying()
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
        refreshNowPlaying()
    }

    var speedLabel: String {
        // 1,2 in French, 1.2 in English: the separator follows the interface.
        let separator = AppLocale.current.decimalSeparator ?? "."
        let text = speed == speed.rounded() ? String(Int(speed)) : String(speed).replacingOccurrences(of: ".", with: separator)
        return text + "×"
    }

    // MARK: Lock screen, Control Center, headset buttons

    /// Set on every state change rather than on every tick: the system
    /// extrapolates the playhead from the rate, and four writes a second
    /// would buy nothing.
    private func refreshNowPlaying() {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: currentChapter?.title ?? episode?.title ?? String(localized: "Briefing"),
            MPMediaItemPropertyArtist: "Podcapp",
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? speed : 0,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: time,
        ]
        if let title = episode?.title { info[MPMediaItemPropertyAlbumTitle] = title }
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        if let artwork = Self.artwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private static let artwork: MPMediaItemArtwork? = {
        guard let image = UIImage(named: "logo") else { return nil }
        return MPMediaItemArtwork(boundsSize: image.size) { _ in image }
    }()

    /// Play/pause from the lock screen, a headset or Siri, ±15 s where a
    /// podcast app puts them, and chapter skips on the track buttons. Without
    /// this the lock screen shows nothing and the AirPods do nothing.
    private func configureRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in self?.play(); return .success }
        center.pauseCommand.addTarget { [weak self] _ in self?.pause(); return .success }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in self?.toggle(); return .success }
        center.skipForwardCommand.preferredIntervals = [15]
        center.skipForwardCommand.addTarget { [weak self] _ in self?.skip(15); return .success }
        center.skipBackwardCommand.preferredIntervals = [15]
        center.skipBackwardCommand.addTarget { [weak self] _ in self?.skip(-15); return .success }
        center.nextTrackCommand.addTarget { [weak self] _ in self?.nextChapter(); return .success }
        center.previousTrackCommand.addTarget { [weak self] _ in self?.previousChapter(); return .success }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let self, let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self.seek(to: event.positionTime)
            return .success
        }
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
            playbackError = item.error?.localizedDescription ?? String(localized: "Playback failed: unreadable audio file.")
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
        refreshNowPlaying()
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

    static func statusLabel(_ status: String) -> String {
        switch status {
        case "ready": return String(localized: "ready")
        case "queued": return String(localized: "queued")
        case "editing": return String(localized: "writing")
        case "tts": return String(localized: "narrating")
        case "assembling": return String(localized: "assembling")
        case "failed": return String(localized: "failed")
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
            // A circle here, not the rounded square of the full player: the
            // mini bar is a capsule and the artwork follows its edge.
            PlayerArtwork(size: 36, radius: 18)
            VStack(alignment: .leading, spacing: 0) {
                Text(player.currentChapter?.title ?? player.episode?.title ?? "Briefing")
                    .typo(Typo.buttonMedium)
                    .foregroundStyle(Palette.ink)
                    .lineLimit(1)
                Text("\(PlayerFormat.time(player.time)) / \(PlayerFormat.time(player.duration))")
                    .typo(Typo.metaMicro.tabular)
                    .foregroundStyle(Palette.muted2)
            }
            // flex:1 in the markup: without it the HStack shrinks to its text
            // and the bar floats as a pill instead of spanning the screen.
            .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                player.toggle()
                player.isPlaying ? Feedback.play() : Feedback.pause()
            } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.onDark)
                    .frame(width: 38, height: 38)
                    .background(Palette.ink, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background {
            Capsule()
                .glass(Palette.miniFill, .filtered)
                // The played fraction runs along the bottom edge, clipped by
                // the capsule so it disappears into the rounded ends.
                .overlay {
                    GeometryReader { geo in
                        Rectangle()
                            .fill(Palette.accentGradient)
                            .frame(width: geo.size.width * player.progress, height: 3)
                            .frame(maxHeight: .infinity, alignment: .bottom)
                    }
                    .clipShape(Capsule())
                }
                .overlay {
                    Capsule().strokeBorder(
                        Palette.glassEdge(Palette.miniBorder, highlight: Palette.innerHighlightStrong),
                        lineWidth: 1
                    )
                }
                .dropShadow(Palette.miniShadow)
        }
        .padding(.horizontal, 14)
        // The prototype floats the bar 8pt clear of the tab bar rather than
        // stacking the two edge to edge.
        .padding(.bottom, 8)
        .contentShape(Capsule())
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
            PlayerBackground()
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
                    title: String(localized: "Loading the briefing"),
                    detail: nil,
                    kind: .neutral,
                    showsSpinner: true
                )
            } else if let loadError = player.loadError {
                PlayerNotice(
                    title: String(localized: "Could not load the episode"),
                    detail: loadError,
                    kind: .danger,
                    showsSpinner: false
                )
            } else if player.episode == nil {
                PlayerNotice(
                    title: String(localized: "Nothing playing"),
                    detail: String(localized: "Open a briefing from the Today tab to listen to it here."),
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
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(Palette.body)
                    .padding(8)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close the player")

            Spacer()
            Overline(text: overline, color: Palette.accentMuted)
            Spacer()

            Button {
                player.sheet = .backstage
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Palette.body)
                    .padding(8)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("How it was made")
        }
        .padding(.horizontal, 16)
        .padding(.top, 6)
    }

    private var overline: String {
        guard let episode = player.episode else { return String(localized: "Briefing") }
        return String(localized: "Briefing · ") + PlayerFormat.day(episode.createdAt)
    }

    private var transport: some View {
        VStack(spacing: 18) {
            Spacer(minLength: 0)

            ZStack(alignment: .bottomTrailing) {
                PlayerArtwork(size: 122, radius: Radius.artwork)
                    .dropShadow(Palette.artworkShadow)
                if player.isPlaying {
                    PlayingBars()
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                        .background(Palette.ink.opacity(0.92), in: Capsule())
                        .dropShadow(Palette.badgeShadow)
                        .offset(x: 6, y: 6)
                }
            }

            VStack(spacing: 7) {
                Text(chapterOverline)
                    .typo(Typo.playerOverline)
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
                    .background(Palette.dangerBg, in: RoundedRectangle(cornerRadius: Radius.icon, style: .continuous))
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
        guard let current = player.currentChapter else { return String(localized: "Briefing") }
        return PlayerSourceText.position(current, in: player.chapters)
    }

    private var displayTime: Double { scrub ?? player.time }

    private var seekBar: some View {
        VStack(spacing: 0) {
            GeometryReader { geo in
                let width = geo.size.width
                let ratio = player.duration > 0 ? min(1, max(0, displayTime / player.duration)) : 0
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Palette.controlBorder)
                        .frame(height: 4)
                    Capsule()
                        .fill(Palette.ink)
                        .frame(width: width * ratio, height: 4)
                    // The ticks are the background showing through the fill,
                    // not a line drawn over it, so they carry the screen base.
                    ForEach(player.chapters.dropFirst()) { chapter in
                        if player.duration > 0 {
                            RoundedRectangle(cornerRadius: 2, style: .continuous)
                                .fill(Palette.screenBase)
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
                // U+2212, as the design writes it: a hyphen next to a timecode
                // reads as a dash between two numbers.
                Text("\u{2212}" + PlayerFormat.time(max(0, player.duration - displayTime)))
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
                    .font(.system(size: 19))
                    .foregroundStyle(Palette.ink)
                    .padding(12)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Previous chapter")

            PlayerSkipButton(
                label: "\u{2212}15",
                accessibility: String(localized: "Skip back 15 seconds")
            ) { Feedback.tap(); player.skip(-15) }

            Button {
                player.toggle()
                player.isPlaying ? Feedback.play() : Feedback.pause()
            } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 22, weight: .medium))
                    .foregroundStyle(Palette.onDark)
                    .frame(width: 68, height: 68)
                    .background(Palette.ink, in: Circle())
                    .dropShadow(Palette.playButtonShadow)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(player.isPlaying ? "Pause" : "Play")

            PlayerSkipButton(
                label: "+15",
                accessibility: String(localized: "Skip forward 15 seconds")
            ) { Feedback.tap(); player.skip(15) }

            Button { player.nextChapter() } label: {
                Image(systemName: "forward.end.fill")
                    .font(.system(size: 19))
                    .foregroundStyle(Palette.ink)
                    .padding(12)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Next chapter")
        }
        .disabled(!player.isPlayable)
        .opacity(player.isPlayable ? 1 : 0.4)
    }

    private var pills: some View {
        HStack(spacing: 8) {
            PlayerPill(label: player.speedLabel) { player.cycleSpeed() }
            PlayerPill(label: String(localized: "Chapters")) { player.sheet = .chapters }
            PlayerPill(label: String(localized: "Transcript")) { player.sheet = .transcript }
        }
    }

    private var sourceButton: some View {
        Button {
            player.sheet = .sources
        } label: {
            HStack(spacing: 11) {
                Text("Source")
                    .textCase(.uppercase)
                    .typo(Typo.fromLabel)
                    .foregroundStyle(Palette.accentMuted)
                Text(sourceLine)
                    .typo(Typo.detail)
                    .foregroundStyle(Palette.ink)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Palette.muted2)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 13)
            .background {
                Capsule()
                    .glass(Palette.miniFill, .filtered)
                    .overlay {
                        Capsule().strokeBorder(Palette.glassEdge(Palette.miniBorder), lineWidth: 1)
                    }
                    .dropShadow(Palette.sourceBarShadow)
            }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .padding(.bottom, 14)
    }

    private var sourceLine: String {
        guard let current = player.currentChapter else { return String(localized: "No source") }
        guard let first = current.sources.first else {
            return String(localized: "Editorial: intro/outro, no external facts")
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
                Button("Close") { player.sheet = nil }
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
        .presentationCornerRadius(Radius.sheet)
        // The design's sheet is a 66% off-white wash over a heavy backdrop
        // blur, not an opaque panel: the player has to stay readable under it.
        .presentationBackground {
            Rectangle().glass(Palette.sheetFill, .filtered)
        }
    }
}

private struct PlayerChaptersSheet: View {
    @ObservedObject private var player = EpisodePlayer.shared

    var body: some View {
        if player.chapters.isEmpty {
            PlayerEmptyLine(text: String(localized: "This episode has no chapters yet."))
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
                            isCurrent ? Palette.rowSelected : Color.clear,
                            in: RoundedRectangle(cornerRadius: Radius.icon, style: .continuous)
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
        let phrases = n == 1 ? String(localized: "1 sentence was checked") : String(localized: "\(n) sentences were checked")
        if fixed == 0 { return String(localized: "\(phrases) against these sources before air. None needed a fix.") }
        let corrected = fixed == 1 ? String(localized: "1 was rewritten") : String(localized: "\(fixed) were rewritten")
        return String(localized: "\(phrases) against these sources before air. \(corrected) to match the evidence.")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let chapter = player.currentChapter {
                Overline(text: chapter.title)

                if chapter.sources.isEmpty {
                    Text("Intro/outro: no external fact.")
                        .typo(Typo.sheetLead)
                        .foregroundStyle(Palette.muted)
                }

                ForEach(chapter.sources) { source in
                    PlayerSourceCard(source: source)
                }

                let missing = chapter.citedCount - chapter.sources.count
                if missing > 0 {
                    PlayerFlag(
                        label: String(localized: "Set aside"),
                        text: missing == 1
                            ? String(localized: "1 cited source is no longer in your library: it is flagged rather than reconstructed.")
                            : String(localized: "\(missing) cited sources are no longer in your library: they are flagged rather than reconstructed.")
                    )
                }

                if !chapter.grounding.isEmpty {
                    PlayerGroupLabel(text: String(localized: "Checked on air"))
                    Text(Self.verdictLine(chapter))
                        .typo(Typo.note)
                        .foregroundStyle(Palette.muted2)

                    VStack(spacing: 0) {
                        ForEach(chapter.grounding) { entry in
                            GroundedSentenceRow(entry: entry)
                            Divider().overlay(Palette.hairline)
                        }
                    }
                } else if !chapter.sources.isEmpty {
                    // No entry at all means nothing in the chapter was checkable,
                    // which is not the same as nothing having been checked.
                    PlayerGroupLabel(text: String(localized: "Checked on air"))
                    Text("No sentence in this chapter carried a number, a quote or a name to check.")
                        .typo(Typo.note)
                        .foregroundStyle(Palette.muted2)
                }
            } else {
                PlayerEmptyLine(text: String(localized: "No chapter playing."))
            }

            Button {
                player.sheet = .backstage
            } label: {
                Text("How this episode was made →")
                    .typo(Typo.buttonMedium)
                    .foregroundStyle(Palette.body)
                    .frame(maxWidth: .infinity)
                    .padding(12)
                    .overlay(
                        RoundedRectangle(cornerRadius: Radius.detail, style: .continuous)
                            .strokeBorder(
                                Palette.dashedBorder,
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
        let shape = RoundedRectangle(cornerRadius: Radius.panel, style: .continuous)
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(PlayerSourceText.publisher(source))
                    .textCase(.uppercase)
                    .typo(Typo.sheetSourcePub)
                    .foregroundStyle(Palette.body)
                Spacer()
                if let lang = source.lang, !lang.isEmpty {
                    Text(lang.uppercased())
                        .typo(Typo.metaTiny)
                        .foregroundStyle(Palette.muted2)
                }
            }
            Text(PlayerSourceText.title(source))
                .typo(Typo.sourceTitle)
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
        .background {
            shape
                .fill(Palette.controlFill)
                .overlay {
                    shape.strokeBorder(
                        LinearGradient(
                            colors: [Palette.innerHighlight, Palette.panelBorder],
                            startPoint: .top,
                            endPoint: .bottom
                        ),
                        lineWidth: 1
                    )
                }
                .dropShadow(Palette.sheetCardShadow)
        }
    }
}

private struct PlayerTranscriptSheet: View {
    @ObservedObject private var player = EpisodePlayer.shared

    var body: some View {
        if let chapter = player.currentChapter, !chapter.text.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                PlayerGroupLabel(
                    text: PlayerSourceText.position(chapter, in: player.chapters)
                        + String(localized: " · in sync")
                )
                Text(chapter.text)
                    .typo(Typo.transcriptBody)
                    .foregroundStyle(Palette.prose)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text("✓ checked: tap SOURCE for the evidence.")
                    .typo(Typo.note)
                    .foregroundStyle(Palette.muted2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 10)
                    .overlay(alignment: .top) { Palette.divider.frame(height: 1) }
            }
        } else {
            PlayerEmptyLine(text: String(localized: "No text for this chapter: the episode has no readable script yet."))
        }
    }
}

private struct PlayerBackstageSheet: View {
    @ObservedObject private var player = EpisodePlayer.shared

    var body: some View {
        if let episode = player.episode {
            EpisodeBackstage(detail: episode)
        } else {
            PlayerEmptyLine(text: String(localized: "Nothing playing."))
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
                .typo(Typo.metaMicro)
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
        .background(Palette.dangerPanelFill, in: RoundedRectangle(cornerRadius: Radius.icon, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.icon, style: .continuous)
                .strokeBorder(Palette.dangerPanelBorder, lineWidth: 1)
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
                .glassPill(shadow: Palette.controlShadow)
        }
        .buttonStyle(.plain)
    }
}

private struct PlayerSkipButton: View {
    let label: String
    let accessibility: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .typo(Typo.tagPill.tabular)
                .foregroundStyle(Palette.ink)
                .frame(width: 46, height: 46)
                .glassPill(shadow: Palette.transportShadow)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibility)
    }
}

/// The group head inside a sheet (CHECKED ON AIR, CHAPTER 1 OF 4 · IN SYNC).
/// One step tighter than `Overline`, which the prototype reserves for headers
/// outside a sheet.
private struct PlayerGroupLabel: View {
    let text: String

    var body: some View {
        Text(text)
            .textCase(.uppercase)
            .typo(Typo.sectionLabel)
            .foregroundStyle(Palette.muted2)
            .padding(.top, 8)
    }
}

private extension View {
    /// The prototype's glass control: a filtered wash, a hairline that
    /// brightens along the top edge in place of CSS's `inset 0 1px 0`, and the
    /// ambient violet drop.
    func glassPill(shadow: Shadow) -> some View {
        background {
            Capsule()
                .glass(Palette.controlFill, .filtered)
                .overlay {
                    Capsule().strokeBorder(
                        LinearGradient(
                            colors: [Palette.innerHighlightSoft, Palette.cardBorder],
                            startPoint: .top,
                            endPoint: .bottom
                        ),
                        lineWidth: 1
                    )
                }
                .dropShadow(shadow)
        }
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
                .strokeBorder(Palette.divider, lineWidth: 1)
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
        return String(localized: "Source")
    }

    static func title(_ source: ChapterSource) -> String {
        if let title = source.title, !title.isEmpty { return title }
        if let url = source.url, !url.isEmpty { return url }
        return String(localized: "Unknown title")
    }

    static func meta(_ source: ChapterSource) -> String? {
        var parts: [String] = []
        if let quality = source.extractionQuality {
            parts.append(String(localized: "Extraction quality ") + PlayerFormat.quality(quality))
        }
        if let host = source.link?.host { parts.append(host) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// Where the chapter sits in the episode. Intro and outro carry no sources,
    /// so the numbering counts only the chapters that do, as the design does.
    static func position(_ chapter: PlayerChapter, in all: [PlayerChapter]) -> String {
        let sourced = all.filter { !$0.sources.isEmpty }
        if let rank = sourced.firstIndex(where: { $0.id == chapter.id }) {
            return String(localized: "Chapter \(rank + 1) of \(sourced.count)")
        }
        if chapter.id == 0 { return "Intro" }
        if chapter.id == all.count - 1 { return "Outro" }
        return String(localized: "Chapter")
    }

    static func chapterSubtitle(_ chapter: PlayerChapter, in all: [PlayerChapter]) -> String {
        if !chapter.sources.isEmpty {
            let names = chapter.sources.map(publisher)
            return names.joined(separator: " · ")
        }
        if chapter.id == 0 { return "Intro" }
        if chapter.id == all.count - 1 { return "Outro" }
        return String(localized: "Editorial")
    }
}

/// The four values the player needs that Theme does not carry yet. Read off
/// v3.html like everything else; promote them to `Palette`/`Typo` once another
/// screen wants them.
// One checked sentence and its verdict. A correction shows both versions: the
// point of the report is that the listener can see what the evidence changed.
private struct GroundedSentenceRow: View {
    let entry: GroundingEntry

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            StatusChip(
                // Feminine: the referent is "une phrase", like the sheet's
                // own copy ("1 a été réécrite").
                label: entry.wasCorrected ? String(localized: "Corrected") : String(localized: "Verified"),
                kind: entry.wasCorrected ? .warning : .success
            )
            .padding(.top, 1)

            VStack(alignment: .leading, spacing: 4) {
                if entry.wasCorrected, let fix = entry.fix {
                    Text(fix)
                        .typo(Typo.detail)
                        .foregroundStyle(Palette.ink2)
                    // The struck original is the whole point of the row: the
                    // listener sees what the evidence changed, not just that
                    // something changed.
                    Text(entry.sentence)
                        .typo(Typo.struckSentence)
                        .foregroundStyle(Palette.muted2)
                        .strikethrough(true, color: Palette.muted2.opacity(0.6))
                } else {
                    Text(entry.sentence)
                        .typo(Typo.detail)
                        .foregroundStyle(Palette.ink2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 9)
    }
}
