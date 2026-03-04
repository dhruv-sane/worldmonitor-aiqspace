/**
 * GeoSentinel Chatbot — LLM-powered war & conflict assistant
 * Connects to /api/chat (Azure OpenAI) with query-aware live context.
 */

interface ChatMessage {
    role: 'user' | 'bot';
    text: string;
}

/**
 * Callback that returns contextual data from the app state.
 * Accepts the user's query so it can search for relevant news.
 */
export type ChatContextProvider = (userQuery: string) => {
    /** Recent news headlines (top 10 general) */
    recentHeadlines: string[];
    /** News items matching the user's query keywords */
    matchedNews: string[];
    /** Clustered multi-source event summaries */
    clusterSummaries: string[];
    /** Currently active map layers */
    activeLayers: string[];
    /** Optional: selected country or region */
    focusRegion?: string;
};

/**
 * Build context string from live app data, including query-matched results.
 * Stays under ~800 tokens to prevent hallucination while being informative.
 */
function buildContextString(provider: ChatContextProvider, userQuery: string): string {
    const ctx = provider(userQuery);
    const parts: string[] = [];

    if (ctx.focusRegion) {
        parts.push(`User is focused on: ${ctx.focusRegion}`);
    }

    if (ctx.activeLayers.length > 0) {
        parts.push(`Active map layers: ${ctx.activeLayers.slice(0, 8).join(', ')}`);
    }

    // Query-matched news first (most relevant)
    if (ctx.matchedNews.length > 0) {
        parts.push(`News matching user query:\n${ctx.matchedNews.map((h, i) => `${i + 1}. ${h}`).join('\n')}`);
    }

    // Multi-source clustered events
    if (ctx.clusterSummaries.length > 0) {
        parts.push(`Trending multi-source events:\n${ctx.clusterSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
    }

    // General recent headlines
    if (ctx.recentHeadlines.length > 0) {
        parts.push(`Recent headlines:\n${ctx.recentHeadlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}`);
    }

    return parts.join('\n\n') || 'No live context available.';
}

export class Chatbot {
    private fab: HTMLButtonElement;
    private win: HTMLDivElement | null = null;
    private messages: ChatMessage[] = [];
    private open = false;
    private contextProvider: ChatContextProvider;
    private isSending = false;

    constructor(contextProvider: ChatContextProvider) {
        this.contextProvider = contextProvider;

        // Floating action button
        this.fab = document.createElement('button');
        this.fab.className = 'gs-chatbot-fab';
        this.fab.id = 'gsChatbotFab';
        this.fab.setAttribute('aria-label', 'Open assistant');
        this.fab.innerHTML = '💬';
        this.fab.addEventListener('click', () => this.toggle());
        document.body.appendChild(this.fab);
    }

    private toggle(): void {
        this.open ? this.close() : this.openChat();
    }

    private openChat(): void {
        if (this.win) return;
        this.open = true;
        this.fab.classList.add('open');
        this.fab.innerHTML = '✕';

        this.win = document.createElement('div');
        this.win.className = 'gs-chatbot-window';
        this.win.id = 'gsChatbotWindow';

        // Header
        const header = document.createElement('div');
        header.className = 'gs-chatbot-header';
        const title = document.createElement('span');
        title.className = 'gs-chatbot-header-title';
        title.textContent = 'GeoSentinel Assistant';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'gs-chatbot-close';
        closeBtn.innerHTML = '✕';
        closeBtn.addEventListener('click', () => this.close());
        header.appendChild(title);
        header.appendChild(closeBtn);
        this.win.appendChild(header);

        // Messages area
        const msgArea = document.createElement('div');
        msgArea.className = 'gs-chatbot-messages';
        msgArea.id = 'gsChatbotMessages';
        this.win.appendChild(msgArea);

        // Input row
        const inputRow = document.createElement('div');
        inputRow.className = 'gs-chatbot-input-row';
        const input = document.createElement('input');
        input.className = 'gs-chatbot-input';
        input.id = 'gsChatbotInput';
        input.type = 'text';
        input.placeholder = 'Ask about wars, conflicts, geopolitics…';
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.send();
        });

        const sendBtn = document.createElement('button');
        sendBtn.className = 'gs-chatbot-send';
        sendBtn.id = 'gsChatbotSendBtn';
        sendBtn.innerHTML = '➤';
        sendBtn.addEventListener('click', () => this.send());

        inputRow.appendChild(input);
        inputRow.appendChild(sendBtn);
        this.win.appendChild(inputRow);

        document.body.appendChild(this.win);

        // Show greeting if first time
        if (this.messages.length === 0) {
            this.addBotMessage("Hi! 👋 I'm the GeoSentinel assistant. Ask me about ongoing wars, conflicts, military movements, or geopolitical news from the dashboard.");
        } else {
            this.renderMessages();
        }

        input.focus();
    }

    private close(): void {
        this.open = false;
        this.fab.classList.remove('open');
        this.fab.innerHTML = '💬';
        if (this.win) {
            this.win.remove();
            this.win = null;
        }
    }

    private async send(): Promise<void> {
        if (this.isSending) return;
        const input = document.getElementById('gsChatbotInput') as HTMLInputElement | null;
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;
        input.value = '';

        this.messages.push({ role: 'user', text });
        this.renderMessages();

        // Disable send button while processing
        this.isSending = true;
        this.setSendEnabled(false);
        this.showTyping();

        try {
            // Pass the user's query so context provider can search for relevant news
            const context = buildContextString(this.contextProvider, text);
            const resp = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: this.messages,
                    context,
                }),
                signal: AbortSignal.timeout(35000),
            });

            this.hideTyping();

            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                const errMsg = (errData as { error?: string }).error || 'Something went wrong.';
                this.addBotMessage(`⚠️ ${errMsg}`);
            } else {
                const data = await resp.json() as { reply: string };
                this.addBotMessage(data.reply);
            }
        } catch (err) {
            this.hideTyping();
            if (err instanceof DOMException && err.name === 'TimeoutError') {
                this.addBotMessage('⚠️ Request timed out. Please try again.');
            } else {
                this.addBotMessage('⚠️ Could not reach the server. Please try again later.');
            }
        } finally {
            this.isSending = false;
            this.setSendEnabled(true);
        }
    }

    private setSendEnabled(enabled: boolean): void {
        const btn = document.getElementById('gsChatbotSendBtn') as HTMLButtonElement | null;
        if (btn) {
            btn.disabled = !enabled;
            btn.style.opacity = enabled ? '1' : '0.5';
        }
    }

    private addBotMessage(text: string): void {
        this.messages.push({ role: 'bot', text });
        this.renderMessages();
    }

    private renderMessages(): void {
        const container = document.getElementById('gsChatbotMessages');
        if (!container) return;
        container.innerHTML = '';
        for (const msg of this.messages) {
            const bubble = document.createElement('div');
            bubble.className = `gs-chat-msg ${msg.role}`;
            // Render markdown for bot messages, plain text for user
            bubble.innerHTML = msg.role === 'bot'
                ? this.renderMarkdown(msg.text)
                : this.escapeHtml(msg.text);
            container.appendChild(bubble);
        }
        container.scrollTop = container.scrollHeight;
    }

    private escapeHtml(str: string): string {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /** Lightweight markdown renderer for chatbot responses */
    private renderMarkdown(text: string): string {
        return text
            .split('\n')
            .map((line) => {
                // Escape HTML first
                let l = this.escapeHtml(line);
                // Bold: **text**
                l = l.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
                // Italic: *text*
                l = l.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
                // Bullet points: - item or • item
                if (/^\s*[-•]\s/.test(l)) {
                    l = `<div class="gs-chat-bullet">${l.replace(/^\s*[-•]\s*/, '• ')}</div>`;
                }
                // Numbered list: 1. item
                else if (/^\s*\d+\.\s/.test(l)) {
                    l = `<div class="gs-chat-bullet">${l}</div>`;
                }
                // Empty line = spacing
                else if (l.trim() === '') {
                    l = '<div class="gs-chat-spacer"></div>';
                }
                // Normal line
                else {
                    l = `<div>${l}</div>`;
                }
                return l;
            })
            .join('');
    }

    private showTyping(): void {
        const container = document.getElementById('gsChatbotMessages');
        if (!container) return;
        const typing = document.createElement('div');
        typing.className = 'gs-typing-indicator';
        typing.id = 'gsChatbotTyping';
        typing.innerHTML = '<span></span><span></span><span></span>';
        container.appendChild(typing);
        container.scrollTop = container.scrollHeight;
    }

    private hideTyping(): void {
        document.getElementById('gsChatbotTyping')?.remove();
    }

    public destroy(): void {
        this.close();
        this.fab.remove();
    }
}
