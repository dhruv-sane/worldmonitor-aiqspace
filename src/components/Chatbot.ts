/**
 * GeoSentinel Chatbot — client-side FAQ assistant
 * No external API required; uses pattern-matching for common questions.
 */

interface ChatMessage {
    role: 'user' | 'bot';
    text: string;
}

const FAQ_PATTERNS: Array<{ patterns: RegExp[]; reply: string }> = [
    {
        patterns: [/what\s*is\s*(this|geosentinel)/i, /about/i, /who\s*made/i, /what\s*does\s*this\s*do/i],
        reply:
            'GeoSentinel is an AI-powered global intelligence dashboard. It aggregates live news, market data, military tracking, infrastructure monitoring, and geopolitical signals into a single real-time view.',
    },
    {
        patterns: [/how\s*(to|do\s*i)\s*use/i, /help/i, /getting\s*started/i, /tutorial/i],
        reply:
            'Use the map to explore hotspots, toggle data layers with the panel on the left, and click any marker for details. Press Ctrl+K (or ⌘K) to open the command palette for quick navigation. The panels below the map show live feeds for news, markets, conflicts, and more.',
    },
    {
        patterns: [/layers?/i, /map\s*layers?/i, /toggle/i, /what\s*can\s*i\s*see/i],
        reply:
            'Available map layers include: Intel Hotspots, Conflict Zones, Military Bases, Undersea Cables, Nuclear Facilities, Pipelines, Earthquakes, Weather Alerts, Military Flights & Vessels, Protests, Internet Outages, Trade Routes, and more. Toggle them from the layer panel on the map.',
    },
    {
        patterns: [/data\s*source/i, /where.*data/i, /sources?/i, /feeds?/i],
        reply:
            'GeoSentinel aggregates data from: ACLED (conflicts), OpenSky/ADS-B (flights), AIS (vessels), USGS (earthquakes), NOAA (weather), GDELT (news), FIRMS (fires), Polymarket (predictions), FRED (economics), and many more open-source intelligence feeds.',
    },
    {
        patterns: [/search/i, /command/i, /keyboard/i, /shortcut/i],
        reply:
            'Press Ctrl+K (⌘K on Mac) to open the command palette. You can search for countries, hotspots, infrastructure, toggle layers, and navigate between views — all from the keyboard.',
    },
    {
        patterns: [/country/i, /intelligence\s*brief/i, /instability/i, /cii/i],
        reply:
            'Click any country on the map to view its Intelligence Brief. This includes an AI-generated instability index, active signals (protests, military, outages), recent news, prediction markets, and infrastructure exposure analysis.',
    },
    {
        patterns: [/theme/i, /dark\s*mode/i, /light\s*mode/i],
        reply:
            'Toggle between dark and light mode using the theme button in the header. The map and all panels will adjust automatically.',
    },
    {
        patterns: [/mobile/i, /phone/i, /tablet/i],
        reply:
            'On mobile devices, GeoSentinel uses a simplified SVG-based map with essential layers pre-enabled. The full WebGL experience is available on desktop browsers.',
    },
];

const FALLBACK_REPLY =
    "I can help with questions about GeoSentinel! Try asking:\n• \"What is this?\"\n• \"How do I use the map?\"\n• \"What layers are available?\"\n• \"Where does the data come from?\"\n• \"What keyboard shortcuts exist?\"";

function matchFaq(input: string): string {
    const lower = input.toLowerCase().trim();
    if (!lower) return FALLBACK_REPLY;
    for (const faq of FAQ_PATTERNS) {
        for (const pat of faq.patterns) {
            if (pat.test(lower)) return faq.reply;
        }
    }
    return FALLBACK_REPLY;
}

export class Chatbot {
    private fab: HTMLButtonElement;
    private win: HTMLDivElement | null = null;
    private messages: ChatMessage[] = [];
    private open = false;

    constructor() {
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
        input.placeholder = 'Ask me anything…';
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.send();
        });

        const sendBtn = document.createElement('button');
        sendBtn.className = 'gs-chatbot-send';
        sendBtn.innerHTML = '➤';
        sendBtn.addEventListener('click', () => this.send());

        inputRow.appendChild(input);
        inputRow.appendChild(sendBtn);
        this.win.appendChild(inputRow);

        document.body.appendChild(this.win);

        // Show greeting if first time
        if (this.messages.length === 0) {
            this.addBotMessage("Hi! 👋 I'm the GeoSentinel assistant. Ask me about the dashboard, map layers, data sources, or keyboard shortcuts.");
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

    private send(): void {
        const input = document.getElementById('gsChatbotInput') as HTMLInputElement | null;
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;
        input.value = '';

        this.messages.push({ role: 'user', text });
        this.renderMessages();

        // Show typing indicator, then respond
        this.showTyping();
        setTimeout(() => {
            this.hideTyping();
            const reply = matchFaq(text);
            this.addBotMessage(reply);
        }, 500 + Math.random() * 400);
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
            bubble.textContent = msg.text;
            container.appendChild(bubble);
        }
        container.scrollTop = container.scrollHeight;
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
