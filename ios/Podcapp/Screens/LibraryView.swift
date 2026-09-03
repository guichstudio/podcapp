import SwiftUI

// The Sources tab: everything captured, what the pipeline made of it, and the
// reason when it went wrong. Layout, spacing and colour come from the v3
// prototype (ios/design/v3-layout.html, the `tabLibrary` branch); the states
// and the counts come from the API, which is why the prototype's AIRED shelf is
// absent — see the notes on LibraryStatus. Its per-row actions exist now: a
// left swipe and a long press both offer Set aside and Delete.

struct LibraryView: View {
    // Same reason as TodayView: the tab stays alive behind .opacity(0), so
    // `.task` runs once. A link shared from another app has to be here when
    // you come back, or the share looks like it was swallowed.
    /// True only for the tab on screen. RootView keeps every opened tab alive
    /// behind .opacity(0), so without this both this screen and its neighbour
    /// answered every return to the foreground with a request nobody was
    /// looking at.
    let isActive: Bool

    @Environment(\.scenePhase) private var scenePhase
    /// When the rows on screen were last read, so a tab you come back to after
    /// a while refreshes and one you flick through does not.
    @State private var loadedAt: Date?
    @State private var sources: [SavedSource] = []
    // The shelves the server files sources under, and the one being looked at.
    // "all" is not a shelf; it is the absence of a filter.
    @State private var categories: [String] = ["tech", "politics", "history", "science", "finance", "other"]
    @State private var category: String?
    @State private var generation: GenerationTarget?
    @State private var generationError: String?
    // The server's own minimum, same source of truth Today reads it from.
    @State private var minimum = 4
    // The address newsletters are forwarded to. Only the server knows it, and
    // only some deployments have one, so the line appears when it exists.
    @State private var ingestAddress: String?
    @State private var askedForIngestAddress = false
    @State private var phase: Phase = .loading
    @State private var filter: LibraryFilter = .all
    @State private var expanded: String?
    @State private var draft = ""
    @State private var addState: AddState = .idle
    // Selection mode. Kept out of `expanded`: a row is either being read or
    // being picked, never both, which is also why entering selection closes
    // whatever was open.
    @State private var selecting = false
    @State private var selection: Set<String> = []
    // At most one row shows its actions at a time, which is what a swipe list
    // does everywhere else on the phone.
    @State private var swiped: String?
    @State private var confirmingRow: SavedSource?
    @State private var confirmingDelete = false
    @State private var deleting = false
    @State private var deleteError: String?

    private enum Phase {
        case loading, loaded, failed(String)
    }

    private enum AddState {
        case idle, sending, done(String), failed(String)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // The 20pt gutter is on each block rather than on the stack,
                // because the category rail is the one thing that has to run
                // past it and off both screen edges.
                header
                    .padding(.top, 6)
                    .padding(.bottom, 14)
                    .padding(.horizontal, 20)

                if selecting {
                    selectionBar.padding(.horizontal, 20)
                    if let deleteError {
                        Text(deleteError)
                            .typo(Typo.metaSmall)
                            .foregroundStyle(Palette.danger)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, 20)
                            .padding(.top, 6)
                    }
                } else {
                    captureField.padding(.horizontal, 20)
                    ingestLine.padding(.horizontal, 20)
                }
                filterPills.padding(.horizontal, 20)
                categoryPills
                if !selecting { categoryGenerate.padding(.horizontal, 20) }
                content.padding(.horizontal, 20)
            }
            .padding(.top, 10)
            .padding(.bottom, 24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(ScreenBackground())
        .confirmationDialog(
            Text("Delete this source?"),
            isPresented: Binding(get: { confirmingRow != nil }, set: { if !$0 { confirmingRow = nil } }),
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                if let row = confirmingRow { Task { await delete(row) } }
                confirmingRow = nil
            } label: { Text("Delete") }
            Button(role: .cancel) { confirmingRow = nil } label: { Text("Cancel") }
        } message: {
            Text("It leaves your library for good. An episode that already cited it keeps the citation, flagged as no longer available.")
        }
        .refreshable { await load() }
        .task { await load() }
        .onChange(of: scenePhase) { _, new in
            if new == .active, isActive { Task { await refresh() } }
        }
        // Coming back to a tab that has been hidden a while: the foreground
        // refresh above skipped it, so it catches up here instead of showing
        // whatever it read when it was last looked at.
        .onChange(of: isActive) { _, now in
            if now { Task { await refresh() } }
        }
    }

    // MARK: - Row actions

    /// Sets a source aside or puts it back. The row is updated in place from
    /// what the server confirms rather than optimistically: this is the only
    /// signal that the story housekeeping behind it actually ran.
    @MainActor
    private func setAside(_ source: SavedSource, _ aside: Bool) async {
        deleteError = nil
        do {
            _ = try await API.shared.setSourcesAside([source.id], aside: aside)
            Feedback.saved()
            await load()
        } catch {
            deleteError = error.localizedDescription
            Feedback.refused()
        }
    }

    @MainActor
    private func delete(_ source: SavedSource) async {
        deleteError = nil
        do {
            let removed = try await API.shared.deleteSources([source.id])
            if removed > 0 { sources.removeAll { $0.id == source.id } }
            Feedback.saved()
            await load()
        } catch {
            deleteError = error.localizedDescription
            Feedback.refused()
        }
    }

    // MARK: - Selection

    /// The title line, with the way in and out of selection mode beside it.
    /// The button is hidden while there is nothing to select, because an
    /// affordance that does nothing is the App Review 2.1 defect we removed
    /// elsewhere in this app.
    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("Sources")
                .typo(Typo.screenTitle)
                .foregroundStyle(Palette.ink)
            Spacer(minLength: 12)
            if !sources.isEmpty {
                Button {
                    Feedback.tap()
                    withAnimation(.easeInOut(duration: 0.18)) {
                        selecting.toggle()
                        selection.removeAll()
                        if selecting { expanded = nil }
                    }
                } label: {
                    Text(selecting ? "Done" : "Select")
                        .typo(Typo.navButton)
                        .foregroundStyle(Palette.accentDeep)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var selectionBar: some View {
        HStack(spacing: 12) {
            Button {
                Feedback.tap()
                let visible = sections.flatMap(\.rows).map(\.id)
                // Acts on what is on screen, not on the whole library: the
                // filter and the shelf above are what the reader is looking at,
                // and "select all" that reaches past them would delete rows
                // nobody was shown.
                if selection.count == visible.count { selection.removeAll() }
                else { selection = Set(visible) }
            } label: {
                Text(selection.isEmpty ? "Select all" : "Deselect")
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.accentDeep)
            }
            .buttonStyle(.plain)

            Spacer(minLength: 8)

            Text("\(selection.count) selected")
                .typo(Typo.metaSmall)
                .foregroundStyle(Palette.muted2)

            Button {
                Feedback.tap()
                confirmingDelete = true
            } label: {
                Group {
                    if deleting {
                        ProgressView().tint(Palette.onDark)
                    } else {
                        Text("Delete").typo(Typo.navButton)
                    }
                }
                .foregroundStyle(Palette.onDark)
                .frame(height: 34)
                .padding(.horizontal, 16)
                .background(selection.isEmpty ? Palette.muted2 : Palette.danger, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(selection.isEmpty || deleting)
        }
        .padding(.vertical, 4)
        .confirmationDialog(
            selection.count == 1 ? Text("Delete this source?") : Text("Delete \(selection.count) sources?"),
            isPresented: $confirmingDelete,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) { Task { await deleteSelected() } } label: { Text("Delete") }
            Button(role: .cancel) {} label: { Text("Cancel") }
        } message: {
            Text("They leave your library for good. An episode that already cited one keeps the citation, flagged as no longer available.")
        }
    }

    @MainActor
    private func deleteSelected() async {
        let ids = Array(selection)
        guard !ids.isEmpty else { return }
        deleting = true
        deleteError = nil
        do {
            let removed = try await API.shared.deleteSources(ids)
            // Drops the rows the server says it removed, so the list never shows
            // something that is gone -- and never hides something that is not.
            let gone = Set(ids)
            if removed > 0 { sources.removeAll { gone.contains($0.id) } }
            selection.removeAll()
            selecting = false
            Feedback.saved()
            await load()
        } catch {
            deleteError = error.localizedDescription
            Feedback.refused()
        }
        deleting = false
    }

    // MARK: - Shelves

    private static func categoryLabel(_ key: String) -> String {
        switch key {
        case "tech": return String(localized: "Technology")
        case "politics": return String(localized: "Politics")
        case "history": return String(localized: "History")
        case "science": return String(localized: "Science")
        case "finance": return String(localized: "Finance")
        case "other": return String(localized: "Other")
        default: return key.capitalized
        }
    }

    private func count(in shelf: String) -> Int { sources.filter { $0.category == shelf }.count }

    /// Same "ready" the row chip already uses (analysed or ready, never a
    /// duplicate or a failure): the count that actually feeds an episode.
    private func readyCount(in shelf: String) -> Int {
        sources.filter { $0.category == shelf && LibraryStatus.of($0).isReady }.count
    }

    /// A rail that bleeds to both screen edges: the design pulls it out of the
    /// 20pt gutter so a chip can scroll off the side rather than stop short of it.
    private var categoryPills: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                shelfPill(nil, label: String(localized: "All"), count: sources.count)
                ForEach(categories, id: \.self) { shelf in
                    let n = count(in: shelf)
                    shelfPill(shelf, label: Self.categoryLabel(shelf), count: n)
                        .opacity(n == 0 ? 0.45 : 1)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 2)
            .padding(.bottom, 6)
        }
        .scrollIndicators(.hidden)
    }

    private func shelfPill(_ shelf: String?, label: String, count: Int) -> some View {
        let selected = shelf == category
        return Button {
            if shelf != category { Feedback.select() }
            category = shelf
        } label: {
            Text(count > 0 && shelf != nil ? "\(label) · \(count)" : label)
                .typo(Typo.pillButton)
                .foregroundStyle(selected ? Palette.onDark : Palette.body)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(selected ? Palette.ink : Palette.pillFill, in: Capsule())
                .overlay(Capsule().strokeBorder(Palette.tileBorder, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
    }

    /// "Make a Finance episode": only on a shelf with something on it. Gated
    /// the same way Today gates its own Generate button, so a shelf under the
    /// minimum explains the rule instead of letting the server's raw refusal
    /// be the first the user hears of it.
    @ViewBuilder
    private var categoryGenerate: some View {
        if let shelf = category, count(in: shelf) > 0 {
            let rule = MinimumSourcesRule(count: readyCount(in: shelf), minimum: minimum)
            VStack(alignment: .leading, spacing: 6) {
                Button {
                    Task { await generate(shelf: shelf) }
                } label: {
                    HStack(spacing: 6) {
                        Text(verbatim: "▶")
                        Text(String(localized: "Make a \(Self.categoryLabel(shelf)) episode"))
                    }
                    .typo(Typo.navButton)
                    .foregroundStyle(Palette.onDark)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Palette.accentGradient, in: Capsule())
                    .overlay(Capsule().strokeBorder(Palette.accentEdge, lineWidth: 1))
                    .dropShadow(Palette.ctaShadow)
                    .opacity(rule.met ? 1 : 0.5)
                }
                .buttonStyle(.plain)
                .disabled(!rule.met)

                if !rule.met {
                    Text(rule.explanation)
                        .typo(Typo.metaSmall)
                        .foregroundStyle(Palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                } else if let generationError {
                    Text(generationError)
                        .typo(Typo.metaSmall)
                        .foregroundStyle(Palette.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.top, 2)
            .padding(.bottom, 10)
            .sheet(item: $generation) { target in GenerationSheet(episodeId: target.id) }
        }
    }

    @MainActor
    private func generate(shelf: String) async {
        generationError = nil
        do {
            let id = try await API.shared.generateEpisode(targetMin: 5, category: shelf)
            generation = GenerationTarget(id: id)
            Feedback.launched()
        } catch APIError.http(_, let message) where !message.isEmpty {
            generationError = message
            Feedback.refused()
        } catch {
            generationError = error.localizedDescription
            Feedback.refused()
        }
    }

    // MARK: - Capture

    private var captureField: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                TextField("Paste a link or some text…", text: $draft, axis: .vertical)
                    .lineLimit(1...4)
                    .typo(Typo.field)
                    .foregroundStyle(Palette.ink)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .background {
                        Capsule()
                            .glass(Palette.pillFill, .filtered)
                            .overlay(Capsule().strokeBorder(Palette.glassEdge(Palette.cardBorder), lineWidth: 1))
                            .dropShadow(Palette.fieldShadow)
                    }
                    .onSubmit { Task { await add() } }

                Button {
                    Task { await add() }
                } label: {
                    Group {
                        if case .sending = addState {
                            ProgressView().tint(Palette.onDark)
                        } else {
                            Text("Add").typo(Typo.navButton)
                        }
                    }
                    .foregroundStyle(Palette.onDark)
                    .frame(height: 38)
                    .padding(.horizontal, 18)
                    .background(Palette.ink, in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(isAddDisabled)
                .opacity(isAddDisabled ? 0.45 : 1)
            }

            switch addState {
            case .idle, .sending:
                EmptyView()
            case let .done(message):
                Text(message)
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.success)
            case let .failed(message):
                Text(message)
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.danger)
            }
        }
        .padding(.bottom, 6)
    }

    /// The other way in: forwarding a newsletter. Drawn only when the server
    /// hands one over, so nobody is told to write to an address that is not live.
    @ViewBuilder
    private var ingestLine: some View {
        if let ingestAddress {
            HStack(spacing: 5) {
                // U+FE0E pins the text presentation. Without it iOS resolves
                // the envelope to the colour emoji, which draws wider and taller
                // than the line it sits on; the design wants a glyph, not a
                // picture.
                Text(verbatim: "\u{2709}\u{FE0E}")
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted)
                Text(verbatim: ingestAddress)
                    .font(Typo.font(size: 11.5, weight: .semibold))
                    .foregroundStyle(Palette.body)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .padding(.bottom, 14)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Ingest address"))
            .accessibilityValue(Text(verbatim: ingestAddress))
        } else {
            Color.clear.frame(height: 8)
        }
    }

    private var isAddDisabled: Bool {
        if case .sending = addState { return true }
        return draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var filterPills: some View {
        HStack(spacing: 6) {
            ForEach(LibraryFilter.allCases) { option in
                Button {
                    filter = option
                    expanded = nil
                } label: {
                    Text(option.label)
                        .typo(Typo.buttonSmall)
                        .foregroundStyle(option == filter ? Palette.onDark : Palette.body)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(option == filter ? Palette.ink : Palette.pillFill, in: Capsule())
                        .overlay(Capsule().strokeBorder(Palette.filterBorder, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(option == filter ? [.isSelected, .isButton] : .isButton)
            }
        }
        .padding(.bottom, 6)
    }

    // MARK: - List

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            message(title: String(localized: "Loading your sources…"), detail: nil, showsSpinner: true)
        case let .failed(reason):
            message(title: String(localized: "Could not load"), detail: reason, isFailure: true)
        case .loaded:
            if sources.isEmpty {
                message(
                    title: String(localized: "No source saved yet."),
                    detail: String(localized: "Share a link from Safari with Podcapp, or paste it above.")
                )
            } else if sections.isEmpty {
                message(
                    title: String(localized: "Nothing in this filter."),
                    detail: String(localized: "\(sources.count) saved in total: tap All to see them.")
                )
            } else {
                ForEach(sections) { section in
                    VStack(alignment: .leading, spacing: 0) {
                        Text(section.title)
                            .textCase(.uppercase)
                            .typo(Typo.sectionLabel)
                            .foregroundStyle(Palette.muted2)
                            .padding(.top, 20)
                            .padding(.bottom, 4)

                        if section.grouped { groupingBanner }

                        ForEach(section.rows) { source in
                            SwipeableRow(
                                id: source.id,
                                open: $swiped,
                                // Selection mode owns the whole row: a swipe
                                // there would fight the checkbox.
                                enabled: !selecting,
                                isAside: source.setAside,
                                onAside: { Task { await setAside(source, !source.setAside) } },
                                onDelete: { confirmingRow = source }
                            ) {
                                row(source)
                            }
                            .contextMenu {
                                if !selecting {
                                    Button {
                                        Task { await setAside(source, !source.setAside) }
                                    } label: {
                                        Label(
                                            source.setAside ? String(localized: "Put back") : String(localized: "Set aside"),
                                            systemImage: source.setAside ? "arrow.uturn.backward" : "tray.and.arrow.down"
                                        )
                                    }
                                    Button(role: .destructive) { confirmingRow = source } label: {
                                        Label(String(localized: "Delete"), systemImage: "trash")
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /// The design's dedupe callout. It names the rule, not a pair of rows: the
    /// API says whether a source has been clustered, never into which story, so
    /// the banner cannot point at the two rows that will share a chapter.
    private var groupingBanner: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(verbatim: "⧉")
                .font(Typo.font(size: 11.5, weight: .semibold))
            Text("Sources grouped into a story air as one chapter")
                .typo(Typo.metaSmall)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(Palette.accentDeep)
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Palette.accentTint,
            in: RoundedRectangle(cornerRadius: Radius.banner, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Radius.banner, style: .continuous)
                .strokeBorder(Palette.accentTintBorder, lineWidth: 1)
        )
        .padding(.top, 6)
        .padding(.bottom, 2)
    }

    /// Loading, failure and the two empty cases share the design's one quiet
    /// treatment for "nothing to show here": centred, small, no card.
    private func message(
        title: String,
        detail: String?,
        showsSpinner: Bool = false,
        isFailure: Bool = false
    ) -> some View {
        VStack(spacing: 8) {
            if showsSpinner { ProgressView().tint(Palette.muted) }
            Text(title)
                .typo(Typo.detail)
                .foregroundStyle(isFailure ? Palette.danger : Palette.muted)
                .multilineTextAlignment(.center)
            if let detail {
                Text(detail)
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted2)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 34)
        .padding(.horizontal, 20)
    }

    private func row(_ source: SavedSource) -> some View {
        let state = LibraryStatus.of(source)
        // A row is either being read or being picked, never both.
        let isOpen = !selecting && expanded == source.id
        let isPicked = selection.contains(source.id)

        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                if selecting {
                    Image(systemName: isPicked ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 21))
                        .foregroundStyle(isPicked ? Palette.accentDeep : Palette.muted2)
                        .frame(height: 36)
                        .transition(.opacity)
                }
                Text(state.icon)
                    .font(Typo.font(size: 13, weight: .regular))
                    .foregroundStyle(Palette.body)
                    .frame(width: 36, height: 36)
                    // The shadow rides on the tile, not on the composited row:
                    // hung outside .background it would halo the glyph too.
                    .background {
                        RoundedRectangle(cornerRadius: Radius.icon, style: .continuous)
                            .fill(Palette.pillFill)
                            .overlay(
                                RoundedRectangle(cornerRadius: Radius.icon, style: .continuous)
                                    .strokeBorder(Palette.cardBorder, lineWidth: 1)
                            )
                            .dropShadow(Palette.tileShadow)
                    }

                VStack(alignment: .leading, spacing: 2) {
                    Text(LibraryRow.publisher(source))
                        .textCase(.uppercase)
                        .typo(Typo.sourcePub)
                        .foregroundStyle(Palette.muted2)
                        .lineLimit(1)
                    Text(LibraryRow.title(source))
                        .typo(Typo.listTitle)
                        .foregroundStyle(Palette.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(LibraryRow.meta(source))
                        .typo(Typo.metaSmall)
                        .foregroundStyle(Palette.muted2)
                        .padding(.top, 1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                if source.setAside {
                    // Its own chip rather than the pipeline's: once a source is
                    // out of the running, READY or EXTRACTING is no longer the
                    // fact that matters about it.
                    SourceStatusChip(label: String(localized: "SET ASIDE"), kind: .neutral, pulses: false)
                        .padding(.top, 2)
                } else {
                    SourceStatusChip(label: state.chip, kind: state.kind, pulses: state.pulses)
                        .padding(.top, 2)
                }
            }
            .opacity(source.setAside ? 0.55 : 1)
            .contentShape(Rectangle())
            .onTapGesture {
                if selecting {
                    Feedback.select()
                    if isPicked { selection.remove(source.id) } else { selection.insert(source.id) }
                } else {
                    withAnimation(.easeInOut(duration: 0.18)) {
                        expanded = isOpen ? nil : source.id
                    }
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(selecting && isPicked ? [.isButton, .isSelected] : .isButton)

            if isOpen {
                VStack(alignment: .leading, spacing: 10) {
                    Text(LibraryRow.detail(source))
                        .typo(Typo.detail)
                        .foregroundStyle(Palette.body)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background {
                    RoundedRectangle(cornerRadius: Radius.detail, style: .continuous)
                        .glass(Palette.panelFill, .filtered)
                        .overlay(
                            RoundedRectangle(cornerRadius: Radius.detail, style: .continuous)
                                .strokeBorder(Palette.glassEdge(Palette.panelBorder), lineWidth: 1)
                        )
                        .dropShadow(Palette.cardShadow)
                }
                .padding(.leading, 48)
                .padding(.top, 10)
            }
        }
        .padding(.vertical, 13)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Palette.hairline).frame(height: 1)
        }
    }

    /// Re-reads only if what is on screen has had time to go stale. Thirty
    /// seconds is well under the time it takes the pipeline to turn a shared
    /// link into anything visible, and it stops a flick through the tabs from
    /// costing four requests.
    @MainActor
    private func refresh() async {
        if let loadedAt, Date().timeIntervalSince(loadedAt) < 30 { return }
        await load()
    }

    // MARK: - Data

    /// The rows on the shelf being looked at; every row when none is.
    private var shelved: [SavedSource] {
        guard let category else { return sources }
        return sources.filter { $0.category == category }
    }

    private var sections: [LibrarySection] {
        let visible = shelved.filter { filter.keeps($0) }
        let problems = visible.filter { LibraryStatus.of($0).isProblem }
        let healthy = visible.filter { !LibraryStatus.of($0).isProblem }
        let calendar = Calendar.current
        let today = healthy.filter { calendar.isDateInToday($0.capturedAt) }
        let earlier = healthy.filter { !calendar.isDateInToday($0.capturedAt) }

        return [
            LibrarySection(id: "today", title: String(localized: "TODAY"), rows: today, grouped: grouped(today)),
            LibrarySection(id: "issues", title: String(localized: "NEEDS A LOOK"), rows: problems, grouped: false),
            // The note rides on TODAY alone, as in the design: it is about what
            // the next episode will do with a fresh capture, and repeating it
            // under every heading turns a callout into wallpaper.
            LibrarySection(id: "earlier", title: String(localized: "EARLIER"), rows: earlier, grouped: false),
        ].filter { !$0.rows.isEmpty }
    }

    /// Two or more clustered sources in one section is the case the banner is
    /// there to explain; under a status filter the section is a partial view of
    /// the shelf, so the note would be about rows that are not on screen.
    private func grouped(_ rows: [SavedSource]) -> Bool {
        filter == .all && rows.filter(\.inStory).count > 1
    }

    private func load() async {
        // Stamped before the call, not after: a slow request must not make the
        // screen look stale enough to fire a second one behind it.
        loadedAt = Date()
        do {
            let batch = try await API.shared.sources()
            sources = batch.sources
            if let shelves = batch.categories { categories = shelves }
            if let serverMinimum = batch.minimum { minimum = serverMinimum }
            phase = .loaded
        } catch {
            phase = .failed(error.localizedDescription)
        }
        // Secondary, and never fatal: without it the screen simply loses one
        // line of copy, so it must not turn a loaded list into an error.
        //
        // Asked once per launch, and that has to be tracked separately from the
        // answer. Latching on `ingestAddress == nil` looked like "asked once"
        // and was not: the server answers null until an inbound address exists,
        // so the nil never went away and every load -- every pull to refresh,
        // every capture, every delete, every swipe -- paid for another
        // authenticated request whose result was already known.
        if !askedForIngestAddress {
            askedForIngestAddress = true
            if let me = try? await API.shared.me() { ingestAddress = me.ingestAddress }
        }
    }

    private func add() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        addState = .sending
        do {
            try await Ingest.save(url: LibraryRow.link(from: text), text: text)
            draft = ""
            addState = .done(String(localized: "Saved. It will join your next briefing."))
            Feedback.saved()
            await load()
        } catch {
            addState = .failed(error.localizedDescription)
            Feedback.refused()
        }
    }
}

// MARK: - Status chip

/// The Library's own status pill: half a point larger and a touch tighter than
/// the shared `StatusChip`, and able to breathe while the pipeline is still
/// working on a row (the design animates EXTRACTING at 1.4 s a cycle).
private struct SourceStatusChip: View {
    let label: String
    let kind: StatusChip.Kind
    let pulses: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dimmed = false

    var body: some View {
        Text(label)
            .textCase(.uppercase)
            .typo(Typo.statusChip)
            .foregroundStyle(kind.foreground)
            .lineLimit(1)
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background(kind.background, in: Capsule())
            .opacity(dimmed ? 0.25 : 1)
            .onAppear {
                guard pulses, !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true)) {
                    dimmed = true
                }
            }
    }
}

// MARK: - Local tokens

/// The design's `inset 0 1px 0 rgba(255,255,255,.9x)` — the one-pixel highlight
/// along the top of a glass surface. SwiftUI has no inset shadow, so the border
/// itself brightens at the top edge, the same fake RootView's tab pill uses.
/// Not in Theme.swift yet; promote if a second screen needs it.
// MARK: - Filters, sections, status mapping

private enum LibraryFilter: String, CaseIterable, Identifiable {
    case all, ready, issues, aside

    var id: String { rawValue }

    var label: String {
        switch self {
        case .all: return String(localized: "All")
        case .ready: return String(localized: "Ready")
        case .issues: return String(localized: "Issues")
        // A state, not the imperative the swipe button uses.
        case .aside: return String(localized: "Aside")
        }
    }

    /// `all` shows everything, set-aside rows included: they are still in the
    /// library and hiding them would make a swipe look like a delete. The other
    /// filters are about the pipeline's opinion of a source, which no longer
    /// applies once the reader has taken it out of the running.
    func keeps(_ source: SavedSource) -> Bool {
        switch self {
        case .all: return true
        case .aside: return source.setAside
        case .ready: return !source.setAside && LibraryStatus.of(source).isReady
        case .issues: return !source.setAside && LibraryStatus.of(source).isProblem
        }
    }
}

private struct LibrarySection: Identifiable {
    let id: String
    let title: String
    let rows: [SavedSource]
    /// Whether this section carries the "will air as one chapter" note.
    let grouped: Bool
}

/// One row's status, translated from `sources.status` in src/db/schema.ts.
///
/// Delete and Set aside are drawn — POST /sources/delete and /sources/aside
/// back them — but the design's third action, retry, still is not: nothing on
/// the server re-runs a failed extraction, and App Review 2.1 does not allow a
/// button that only says it does nothing. The AIRED shelf is absent for a
/// different reason: `aired` is a story status on the server, never a source
/// one, so no row can carry it.
private struct LibraryStatus {
    let chip: String
    let kind: StatusChip.Kind
    let icon: String
    let isReady: Bool
    let isProblem: Bool
    /// Work still in flight, which the chip shows by breathing.
    var pulses = false

    static func of(_ source: SavedSource) -> LibraryStatus {
        switch source.status {
        case "received":
            // The queue drains on the laptop, so this is where a fresh capture
            // rests: normal, not a failure.
            return LibraryStatus(
                chip: String(localized: "QUEUED"), kind: .neutral, icon: glyph(source),
                isReady: false, isProblem: false
            )
        case "extracting":
            return LibraryStatus(
                chip: String(localized: "EXTRACTING"), kind: .warning, icon: glyph(source),
                isReady: false, isProblem: false, pulses: true
            )
        case "analyzed":
            return LibraryStatus(
                chip: String(localized: "ANALYSED"), kind: .neutral, icon: glyph(source),
                isReady: true, isProblem: false
            )
        case "ready":
            return LibraryStatus(
                chip: String(localized: "READY"), kind: .success, icon: glyph(source),
                isReady: true, isProblem: false
            )
        case "duplicate":
            return LibraryStatus(
                chip: String(localized: "DUPLICATE"), kind: .neutral, icon: "⧉",
                isReady: false, isProblem: true
            )
        case "extraction_failed", "low_quality", "unsupported":
            // Three ways to end up without usable text; the row's error line says
            // which one, so they share the one chip the design gives them.
            return LibraryStatus(
                chip: String(localized: "FAILED"), kind: .danger, icon: "\u{26A0}\u{FE0E}",
                isReady: false, isProblem: true
            )
        default:
            return LibraryStatus(
                chip: source.status.uppercased(), kind: .neutral, icon: glyph(source),
                isReady: false, isProblem: false
            )
        }
    }

    private static func glyph(_ source: SavedSource) -> String {
        // Text presentation, as in `ingestLine`: the bare envelope and the
        // bare warning sign both default to colour emoji on iOS.
        source.type == "email" ? "\u{2709}\u{FE0E}" : "¶"
    }
}

// MARK: - Row copy

private enum LibraryRow {
    static func publisher(_ source: SavedSource) -> String {
        if let publisher = source.publisher, !publisher.isEmpty { return publisher }
        if let host = source.link?.host { return host }
        return source.type
    }

    static func title(_ source: SavedSource) -> String {
        if let title = source.title, !title.isEmpty { return title }
        if let url = source.url, !url.isEmpty { return url }
        return String(localized: "Untitled")
    }

    static func meta(_ source: SavedSource) -> String {
        var parts = [source.type]
        if let lang = source.lang, !lang.isEmpty { parts.append(lang.uppercased()) }
        parts.append(stamp(source.capturedAt))
        if let quality = source.extractionQuality {
            parts.append(String(localized: "quality ") + decimal(quality))
        }
        return parts.joined(separator: " · ")
    }

    /// The sentence under an expanded row. The server's own `error` wins over any
    /// wording of ours: it is the only text that says what actually broke.
    static func detail(_ source: SavedSource) -> String {
        if let error = source.error, !error.isEmpty { return error }
        switch source.status {
        case "received":
            return String(localized: "Queued. Extraction runs at the next pass.")
        case "extracting":
            return String(localized: "Extracting…")
        case "analyzed":
            return source.inStory
                ? String(localized: "Analysed and attached to a story.")
                : String(localized: "Analysed, waiting to be grouped.")
        case "ready":
            return source.inStory
                ? String(localized: "Ready and attached to a story: a candidate for the next briefing.")
                : String(localized: "Ready for the next briefing.")
        case "duplicate":
            return String(localized: "Already saved: counted once.")
        case "extraction_failed", "low_quality", "unsupported":
            return String(localized: "Extraction failed, with no detail from the server.")
        default:
            return String(localized: "Status “\(source.status)” unknown to the app.")
        }
    }

    /// `{url}` and `{text}` are different payloads at /ingest, so a pasted link
    /// must be recognised as one rather than saved as prose.
    static func link(from text: String) -> URL? {
        let lowered = text.lowercased()
        guard lowered.hasPrefix("http://") || lowered.hasPrefix("https://") else { return nil }
        guard let url = URL(string: text), url.host != nil else { return nil }
        return url
    }

    private static let time: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = AppLocale.current
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    private static let day: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = AppLocale.current
        formatter.setLocalizedDateFormatFromTemplate("d MMM")
        return formatter
    }()

    private static func stamp(_ date: Date) -> String {
        Calendar.current.isDateInToday(date) ? time.string(from: date) : day.string(from: date)
    }

    private static func decimal(_ value: Double) -> String {
        String(format: "%.2f", value).replacingOccurrences(of: ".", with: ",")
    }
}

/// A row you can push to the left to reveal two actions, plus the same two
/// under a long press.
///
/// Not `List` + `.swipeActions`: the Library is a ScrollView of hand-drawn rows
/// on a gradient, and a List would throw the design away. The actions sit
/// BESIDE the row inside a clipped strip rather than behind it, because a row
/// with a transparent background would otherwise show them through itself.
private struct SwipeableRow<Content: View>: View {
    let id: String
    @Binding var open: String?
    let enabled: Bool
    let isAside: Bool
    let onAside: () -> Void
    let onDelete: () -> Void
    @ViewBuilder var content: Content

    @State private var offset: CGFloat = 0
    @State private var committed: CGFloat = 0

    private let actionWidth: CGFloat = 172
    /// How far a tile's shadow reaches past the row. Palette.tileShadow and
    /// Palette.cardShadow both stay well inside this.
    private let shadowRoom: CGFloat = 24

    var body: some View {
        content
            .offset(x: offset)
            // The actions ride in from the trailing edge as an overlay, so the
            // row keeps its natural height and is built ONCE. The first version
            // put them in an HStack inside a GeometryReader and needed a hidden
            // second copy of the row to give that reader a height -- which also
            // meant every pulsing status chip animated twice, invisibly.
            // While the drawer is open the row itself answers a tap by closing
            // it, the way a swipe list does everywhere else: without this, a tap
            // fell through to the row and expanded its detail panel underneath
            // the still-open actions.
            .overlay {
                if offset != 0 {
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture {
                            close()
                            if open == id { open = nil }
                        }
                }
            }
            // Added after the tap-catcher on purpose: the buttons have to sit
            // above it or they would never be reachable.
            .overlay(alignment: .trailing) {
                actions
                    .frame(width: actionWidth)
                    .frame(maxHeight: .infinity)
                    .offset(x: actionWidth + offset)
            }
            // Masked rather than clipped. `.clipped()` cuts to the row's own
            // bounds, which took the drop shadow off every tile and card inside
            // it; the mask is taller than the row on both sides, so shadows
            // survive while the drawer is still hidden horizontally.
            .mask(Rectangle().padding(.vertical, -shadowRoom))
            .animation(.spring(response: 0.3, dampingFraction: 0.85), value: offset)
        .contentShape(Rectangle())
        .gesture(enabled ? drag : nil)
        // Opening one row closes every other: two half-open rows read as a bug.
        .onChange(of: open) { _, now in
            if now != id { close() }
        }
        .onChange(of: enabled) { _, on in
            if !on { close() }
        }
    }

    private var actions: some View {
        HStack(spacing: 0) {
            action(
                label: isAside ? String(localized: "Put back") : String(localized: "Set aside"),
                icon: isAside ? "arrow.uturn.backward" : "tray.and.arrow.down",
                tint: Palette.accentDeep
            ) {
                close()
                onAside()
            }
            action(label: String(localized: "Delete"), icon: "trash", tint: Palette.danger) {
                close()
                onDelete()
            }
        }
    }

    private func action(label: String, icon: String, tint: Color, run: @escaping () -> Void) -> some View {
        Button {
            Feedback.tap()
            run()
        } label: {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 17, weight: .semibold))
                Text(label).typo(Typo.metaSmall).lineLimit(1).minimumScaleFactor(0.8)
            }
            .foregroundStyle(Palette.onDark)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(tint)
        }
        .buttonStyle(.plain)
    }

    private var drag: some Gesture {
        DragGesture(minimumDistance: 14)
            .onChanged { value in
                // Horizontal only: the vertical component belongs to the
                // ScrollView this row lives in.
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                offset = min(0, max(-actionWidth, committed + value.translation.width))
            }
            .onEnded { value in
                // The same direction test as onChanged, and it has to be here
                // too: a mostly-vertical flick with a little leftward velocity
                // left `offset` at 0 but still had enough predicted width to
                // snap the drawer open under a scroll.
                guard abs(value.translation.width) > abs(value.translation.height) else {
                    close()
                    if open == id { open = nil }
                    return
                }
                let projected = offset + value.predictedEndTranslation.width * 0.2
                if projected < -actionWidth / 2 {
                    committed = -actionWidth
                    offset = -actionWidth
                    open = id
                } else {
                    close()
                    if open == id { open = nil }
                }
            }
    }

    private func close() {
        committed = 0
        offset = 0
    }
}
