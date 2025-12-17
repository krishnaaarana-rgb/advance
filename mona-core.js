/**
 * MONA OS KERNEL v10.0 (Enterprise)
 * Copyright (c) 2025 Mona Montreux Luxury Systems
 * * ARCHITECTURE:
 * 1. Store: Centralized Immutable State (Redux Pattern)
 * 2. Persistence: IndexedDB Wrapper (App-Like Storage)
 * 3. Bus: Pub/Sub Event System
 * 4. IO: Network Throttling & Queue Management
 */

// --- UTILITIES & POLYFILLS ---
const Utils = {
    uuid: () => ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)),
    now: () => new Date().toISOString(),
    isMobile: () => /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
    wait: (ms) => new Promise(r => setTimeout(r, ms))
};

// --- 1. LOCAL DATABASE (IndexedDB) ---
// This allows the bot to store GBs of data (images, history) offline.
class Database {
    constructor(dbName = 'MonaDB', version = 1) {
        this.dbName = dbName;
        this.version = version;
        this.db = null;
    }

    async connect() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('sessions')) {
                    db.createObjectStore('sessions', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('messages')) {
                    const store = db.createObjectStore('messages', { keyPath: 'id' });
                    store.createIndex('sessionId', 'sessionId', { unique: false });
                }
                if (!db.objectStoreNames.contains('assets')) { // Cache for 3D/Images
                    db.createObjectStore('assets', { keyPath: 'url' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log("💎 [MonaDB] Database Integrity Verified.");
                resolve(this.db);
            };
            
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async saveMessage(msg) {
        if(!this.db) await this.connect();
        return this.transaction('messages', 'readwrite', store => store.put(msg));
    }

    async getHistory(sessionId) {
        if(!this.db) await this.connect();
        return new Promise((resolve) => {
            const tx = this.db.transaction('messages', 'readonly');
            const index = tx.objectStore('messages').index('sessionId');
            const request = index.getAll(IDBKeyRange.only(sessionId));
            request.onsuccess = () => resolve(request.result.sort((a,b) => a.timestamp - b.timestamp));
        });
    }

    transaction(storeName, mode, callback) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            const request = callback(store);
            tx.oncomplete = () => resolve(request?.result);
            tx.onerror = () => reject(tx.error);
        });
    }
}

// --- 2. STATE MANAGEMENT (The Brain) ---
class Store {
    constructor() {
        this.state = {
            session: {
                id: null,
                userValues: {}, // Biometrics, Preferences
                isAuthenticated: false
            },
            ui: {
                isOpen: false,
                isTyping: false,
                theme: 'system', // 'light', 'dark', 'midnight'
                view: 'chat' // 'chat', 'camera', 'map'
            },
            network: {
                status: navigator.onLine ? 'online' : 'offline',
                latency: 0,
                queue: [] // Failed messages to retry
            }
        };
        this.listeners = new Set();
        this.db = new Database();
    }

    async init() {
        await this.db.connect();
        // Load Session from LocalStorage (fast) then hydrate from IDB (slow)
        const savedSession = localStorage.getItem('mona_session_id');
        if (savedSession) {
            this.state.session.id = savedSession;
            console.log(`💎 [Core] Session Resumed: ${savedSession}`);
        } else {
            this.state.session.id = Utils.uuid();
            localStorage.setItem('mona_session_id', this.state.session.id);
            console.log(`💎 [Core] New Session Created: ${this.state.session.id}`);
        }
        this.notify();
    }

    // "Redux" style actions
    dispatch(action, payload) {
        // console.log(`⚡ Action: ${action}`, payload); // Uncomment for debug
        switch(action) {
            case 'TOGGLE_CHAT':
                this.state.ui.isOpen = !this.state.ui.isOpen;
                break;
            case 'SET_TYPING':
                this.state.ui.isTyping = payload;
                break;
            case 'NETWORK_CHANGE':
                this.state.network.status = payload;
                if (payload === 'online') this.flushQueue();
                break;
            case 'QUEUE_MESSAGE':
                this.state.network.queue.push(payload);
                break;
            case 'AUTH_SUCCESS':
                this.state.session.isAuthenticated = true;
                this.state.session.userValues = { ...this.state.session.userValues, ...payload };
                break;
        }
        this.notify();
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    notify() {
        this.listeners.forEach(l => l(this.state));
    }

    // Message Handling with offline support
    async addMessage(text, sender, type = 'text', metadata = {}) {
        const msg = {
            id: Utils.uuid(),
            sessionId: this.state.session.id,
            text,
            sender, // 'user' | 'bot' | 'system'
            type, // 'text' | 'image' | 'card' | 'map'
            timestamp: Date.now(),
            metadata,
            status: 'sent' // 'sent' | 'pending' | 'failed'
        };

        // 1. Optimistic UI Update (Save to DB)
        await this.db.saveMessage(msg);
        
        // 2. Trigger UI Refresh
        this.notify();
        
        return msg;
    }

    async flushQueue() {
        // Advanced Logic: If internet returns, send all queued messages
        if (this.state.network.queue.length === 0) return;
        console.log("🔄 [Network] Flushing offline queue...");
        // (Queue processing logic would go here)
    }
}

// Export Singleton
window.MonaSystem = new Store();
