import SwiftUI

/// The unread count behind the Settings badge and the dot on its tab.
///
/// One shared object because three places move it: the app coming back to the
/// foreground, a support notification arriving while the app is open, and the
/// chat itself, which zeroes it by reading the thread.
@MainActor
final class SupportInbox: ObservableObject {
    static let shared = SupportInbox()

    @Published private(set) var unread = 0

    func refresh() async {
        guard Config.isConfigured else { return }
        // A failed refresh keeps the last count: a badge that vanishes on a
        // network hiccup would read as "nothing new" when there may be.
        if let me = try? await API.shared.me() {
            unread = me.supportUnread ?? 0
        }
    }

    /// The server marks the thread read when the chat loads it; this mirrors
    /// that without spending a request.
    func markAllRead() { unread = 0 }
}

/// The support chat: one thread with Louis, who answers by hand from the admin
/// page. Feedback requests arrive here too, as messages from him.
struct SupportView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var messages: [SupportMessage] = []
    @State private var pending: [Pending] = []
    @State private var draft = ""
    @State private var loaded = false
    @State private var loadError: String?
    @FocusState private var composing: Bool

    /// A message on its way, or one that did not make it. Kept on screen with
    /// what was typed, because losing someone's words to a dropped connection
    /// is the one thing a support chat must never do.
    private struct Pending: Identifiable, Equatable {
        let id = UUID()
        let body: String
        var failed = false
    }

    private static let bubbleText = TypoStyle(size: 14.5, weight: .regular, lineHeight: 1.4)
    private static let time: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = AppLocale.current
        formatter.setLocalizedDateFormatFromTemplate("d MMM HH:mm")
        return formatter
    }()

    var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(Palette.hairline).frame(height: 1)
            thread
            composer
        }
        .background(ScreenBackground())
        .presentationDragIndicator(.visible)
        // Reloaded every 10 s while the sheet is up: a reply typed on the admin
        // page shows up without the person having to close and reopen. The
        // loop ends with the sheet, since .task is cancelled on disappear.
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(10))
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 10) {
            ZStack {
                Circle().fill(Palette.accentTint).frame(width: 34, height: 34)
                Text(verbatim: "L").typo(Typo.buttonMedium).foregroundStyle(Palette.accentDeep)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: "Louis · Podcapp")
                    .typo(Typo.rowLabelStrong)
                    .foregroundStyle(Palette.ink)
                Text("Usually replies within a day")
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted2)
            }
            Spacer(minLength: 8)
            Button("Close") { dismiss() }
                .typo(Typo.navButton)
                .foregroundStyle(Palette.accentDeep)
        }
        .padding(.horizontal, 20)
        .padding(.top, 20)
        .padding(.bottom, 12)
    }

    // MARK: - Thread

    private var thread: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 8) {
                    if loaded && messages.isEmpty && pending.isEmpty {
                        emptyState
                    }
                    ForEach(messages) { message in
                        bubble(message.body, mine: !message.fromAdmin, caption: Self.time.string(from: message.createdAt))
                            .id(message.id)
                    }
                    ForEach(pending) { item in
                        pendingBubble(item)
                            .id(item.id.uuidString)
                    }
                    if let loadError, messages.isEmpty {
                        Text(loadError)
                            .typo(Typo.note)
                            .foregroundStyle(Palette.danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: messages.count + pending.count) { _, _ in
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .onChange(of: composing) { _, focused in
                if focused { proxy.scrollTo("bottom", anchor: .bottom) }
            }
        }
    }

    private var emptyState: some View {
        Text("A question, a bug, an idea? Louis reads everything and replies here.")
            .typo(Typo.sheetLead)
            .foregroundStyle(Palette.muted2)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 24)
            .padding(.top, 60)
            .frame(maxWidth: .infinity)
    }

    private func bubble(_ text: String, mine: Bool, caption: String?) -> some View {
        VStack(alignment: mine ? .trailing : .leading, spacing: 3) {
            Text(text)
                .typo(Self.bubbleText)
                .foregroundStyle(mine ? Palette.onDark : Palette.ink)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 13)
                .padding(.vertical, 9)
                .background(
                    mine ? AnyShapeStyle(Palette.ink) : AnyShapeStyle(Palette.tileFillStrong),
                    in: RoundedRectangle(cornerRadius: 17, style: .continuous)
                )
                .overlay {
                    if !mine {
                        RoundedRectangle(cornerRadius: 17, style: .continuous)
                            .strokeBorder(Palette.tileBorder, lineWidth: 1)
                    }
                }
            if let caption {
                Text(caption)
                    .typo(Typo.metaTiny)
                    .foregroundStyle(Palette.faint)
                    .padding(.horizontal, 4)
            }
        }
        .frame(maxWidth: 290, alignment: mine ? .trailing : .leading)
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
    }

    @ViewBuilder
    private func pendingBubble(_ item: Pending) -> some View {
        if item.failed {
            Button {
                Task { await send(item.body, retrying: item.id) }
            } label: {
                VStack(alignment: .trailing, spacing: 3) {
                    Text(item.body)
                        .typo(Self.bubbleText)
                        .foregroundStyle(Palette.danger)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 13)
                        .padding(.vertical, 9)
                        .background(Palette.dangerBg, in: RoundedRectangle(cornerRadius: 17, style: .continuous))
                    Text("Not sent · tap to retry")
                        .typo(Typo.metaTiny)
                        .foregroundStyle(Palette.danger)
                        .padding(.horizontal, 4)
                }
                .frame(maxWidth: 290, alignment: .trailing)
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .buttonStyle(.plain)
        } else {
            bubble(item.body, mine: true, caption: String(localized: "Sending…"))
                .opacity(0.6)
        }
    }

    // MARK: - Composer

    private var trimmedDraft: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            // An explicit prompt colour: the system placeholder grey disappears
            // against this near-white field.
            TextField("", text: $draft, prompt: Text("Write to Louis…").foregroundStyle(Palette.muted2), axis: .vertical)
                .typo(Typo.field)
                .foregroundStyle(Palette.ink)
                .lineLimit(1...5)
                .focused($composing)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Palette.tileFillStrong, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .strokeBorder(Palette.controlBorder, lineWidth: 1)
                )
            Button {
                let body = trimmedDraft
                guard !body.isEmpty else { return }
                draft = ""
                Task { await send(body, retrying: nil) }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Palette.onDark)
                    .frame(width: 38, height: 38)
                    .background(trimmedDraft.isEmpty ? Palette.faint : Palette.ink, in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(trimmedDraft.isEmpty)
            .accessibilityLabel(Text("Send"))
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 12)
    }

    // MARK: - Network

    private func load() async {
        do {
            let fresh = try await API.shared.supportMessages()
            if fresh != messages { messages = fresh }
            loadError = nil
            SupportInbox.shared.markAllRead()
        } catch {
            loadError = error.localizedDescription
        }
        loaded = true
    }

    private func send(_ body: String, retrying id: UUID?) async {
        let wasFirst = !messages.contains { !$0.fromAdmin }
        let item: Pending
        if let id, let index = pending.firstIndex(where: { $0.id == id }) {
            pending[index].failed = false
            item = pending[index]
        } else {
            item = Pending(body: body)
            pending.append(item)
        }
        Feedback.tap()
        do {
            let sent = try await API.shared.sendSupportMessage(body)
            pending.removeAll { $0.id == item.id }
            if !messages.contains(where: { $0.id == sent.id }) { messages.append(sent) }
            // The second moment a notification prompt is obviously welcome:
            // someone has just asked Louis something and will want the answer.
            if wasFirst { await Push.askAndRegister() }
        } catch {
            if let index = pending.firstIndex(where: { $0.id == item.id }) { pending[index].failed = true }
            Feedback.refused()
        }
    }
}

#Preview {
    SupportView()
}
