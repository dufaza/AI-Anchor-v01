import React, { useState, useRef, useEffect } from 'react';
import { Send, LifeBuoy, UserCog, BrainCircuit, ScrollText, CheckCircle2, ChevronRight, MessageSquare, Anchor, Wind, Scale, Ship } from 'lucide-react';
import { ChatMessage, BoatData, ChainData, SensorData } from '../types';
import { getSailingAdvice } from '../services/geminiService';

interface AIAssistantProps {
    boatData: BoatData;
    windSpeed: number;
    depth: number;
    seabedType: string;
    chainData: ChainData;
    sensorData: SensorData;
    riskScore: number;
}

const AIAssistant: React.FC<AIAssistantProps> = ({
    boatData,
    windSpeed,
    depth,
    seabedType,
    chainData,
    sensorData,
    riskScore
}) => {
    // --- State: Modes & Config ---
    const [viewMode, setViewMode] = useState<'chat' | 'architect'>('architect');
    
    // Architect Configuration
    const [persona, setPersona] = useState<string>("Instructor");
    const [customContext, setCustomContext] = useState<string>("");
    const [tone, setTone] = useState<string>("Concise");

    // Chat State
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, viewMode]);

    // Initial Welcome Message Logic
    useEffect(() => {
        if (messages.length === 0 && viewMode === 'chat') {
             setMessages([
                {
                    id: 'init',
                    role: 'model',
                    text: `Hello Skipper! I'm configured as your ${persona}. I have all telemetry from ${boatData.name}. How can I assist?`,
                    timestamp: Date.now()
                }
            ]);
        }
    }, [viewMode, messages.length]);


    // --- Context Builder Logic ---
    const buildSystemInstruction = () => {
        return `
        ROLE: You are an expert sailing assistant acting as a "${persona}".
        
        VESSEL IDENTITY:
        - Name: ${boatData.name}
        - Model: ${boatData.model}
        - Specs: Length ${boatData.length}m, Weight ${boatData.displacement}kg.
        - Anchor: ${boatData.anchorWeight}kg.
        
        LIVE TELEMETRY (Current Status):
        - Weather: Wind ${windSpeed} knots.
        - Environment: Depth ${depth}m, Seabed "${seabedType}".
        - Ground Tackle: Chain deployed ${chainData.actualLength}m (Required: ${chainData.requiredLength.toFixed(1)}m).
        - Sensors: Pitch ${sensorData.pitch.toFixed(1)}°, Roll ${sensorData.roll.toFixed(1)}°.
        
        USER NOTES (Specific Context):
        "${customContext}"
        
        GUIDELINES:
        - Tone: ${tone}.
        - Always use metric units unless asked otherwise.
        - If the user asks about scope, use the live data above to give a specific calculation for THIS boat.
        `;
    };

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMsg: ChatMessage = {
            id: Date.now().toString(),
            role: 'user',
            text: input,
            timestamp: Date.now()
        };

        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsLoading(true);

        // Call Gemini with the DYNAMIC system instruction built by the Architect
        const systemInstruction = buildSystemInstruction();
        const responseText = await getSailingAdvice(userMsg.text, systemInstruction);

        const modelMsg: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'model',
            text: responseText,
            timestamp: Date.now()
        };

        setMessages(prev => [...prev, modelMsg]);
        setIsLoading(false);
    };

    // --- RENDER: ARCHITECT MODE ---
    if (viewMode === 'architect') {
        return (
            <div className="flex flex-col h-full bg-ocean-900 animate-in fade-in slide-in-from-right duration-300 pb-24 overflow-y-auto">
                {/* Header */}
                <div className="p-4 bg-ocean-900 border-b border-ocean-800 flex justify-between items-center sticky top-0 z-10 backdrop-blur-md bg-ocean-900/90">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <BrainCircuit className="w-6 h-6 text-ocean-500" />
                            Context Architect
                        </h2>
                        <p className="text-xs text-ocean-400">Configure AI Brain</p>
                    </div>
                    <button 
                        onClick={() => setViewMode('chat')}
                        className="bg-safe-600 hover:bg-safe-500 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors"
                    >
                        Start Chat <ChevronRight className="w-4 h-4" />
                    </button>
                </div>

                <div className="p-4 space-y-6">
                    
                    {/* Section 1: ROLE */}
                    <section className="space-y-3">
                        <div className="flex items-center gap-2 text-ocean-300 text-xs font-bold uppercase tracking-wider">
                            <UserCog className="w-4 h-4" /> Role (Persona)
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            {['Instructor', 'Expert', 'Old Salt', 'Racer'].map((p) => (
                                <button
                                    key={p}
                                    onClick={() => setPersona(p)}
                                    className={`p-3 rounded-xl border text-left transition-all ${
                                        persona === p 
                                        ? 'bg-ocean-600 border-ocean-400 text-white ring-2 ring-ocean-500/50' 
                                        : 'bg-ocean-800 border-ocean-700 text-gray-400 hover:bg-ocean-700'
                                    }`}
                                >
                                    <div className="font-bold text-sm">{p}</div>
                                    <div className="text-[10px] opacity-70">
                                        {p === 'Instructor' && 'Pedagogical & Safe'}
                                        {p === 'Expert' && 'Technical & Precise'}
                                        {p === 'Old Salt' && 'Brief & Nautical'}
                                        {p === 'Racer' && 'Performance focus'}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </section>

                    {/* Section 2: KNOWLEDGE BASE (Live Data) */}
                    <section className="space-y-3">
                        <div className="flex items-center gap-2 text-ocean-300 text-xs font-bold uppercase tracking-wider">
                            <BrainCircuit className="w-4 h-4" /> Knowledge Base (Live)
                        </div>
                        
                        <div className="bg-ocean-800/50 rounded-xl border border-ocean-700/50 p-4 space-y-3">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-ocean-700 rounded-lg"><Ship className="w-4 h-4 text-white" /></div>
                                <div>
                                    <div className="text-white text-sm font-bold">{boatData.name || "My Boat"}</div>
                                    <div className="text-xs text-ocean-400">{boatData.model} • {boatData.displacement}kg</div>
                                </div>
                            </div>
                            <div className="h-px bg-ocean-700/50"></div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="flex items-center gap-2">
                                    <Wind className="w-3 h-3 text-ocean-400" />
                                    <span className="text-xs text-gray-300">{windSpeed} kts Wind</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Anchor className="w-3 h-3 text-ocean-400" />
                                    <span className="text-xs text-gray-300">{chainData.actualLength}m Chain</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Scale className="w-3 h-3 text-ocean-400" />
                                    <span className="text-xs text-gray-300">{depth}m Depth</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full border border-ocean-400 flex items-center justify-center text-[8px] text-ocean-400">S</div>
                                    <span className="text-xs text-gray-300">{seabedType}</span>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] text-ocean-400 uppercase font-bold ml-1">Add Manual Context</label>
                            <textarea
                                value={customContext}
                                onChange={(e) => setCustomContext(e.target.value)}
                                placeholder="e.g. Crowded anchorage, expecting storm, staying 3 days..."
                                className="w-full bg-ocean-800 border border-ocean-700 rounded-xl p-3 text-sm text-white focus:ring-1 focus:ring-ocean-500 focus:outline-none min-h-[80px]"
                            />
                        </div>
                    </section>

                    {/* Section 3: GUIDELINES */}
                    <section className="space-y-3">
                        <div className="flex items-center gap-2 text-ocean-300 text-xs font-bold uppercase tracking-wider">
                            <ScrollText className="w-4 h-4" /> Guidelines
                        </div>
                        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
                            {['Concise', 'Detailed', 'Bullet Points'].map((t) => (
                                <button
                                    key={t}
                                    onClick={() => setTone(t)}
                                    className={`px-4 py-2 rounded-full text-xs font-bold border whitespace-nowrap transition-colors ${
                                        tone === t 
                                        ? 'bg-ocean-500 border-ocean-400 text-white' 
                                        : 'bg-ocean-900 border-ocean-700 text-gray-400'
                                    }`}
                                >
                                    {t}
                                </button>
                            ))}
                        </div>
                    </section>

                </div>
            </div>
        );
    }

    // --- RENDER: CHAT MODE ---
    return (
        <div className="flex flex-col h-full pb-20 bg-ocean-900">
             <div className="p-4 bg-ocean-900 border-b border-ocean-800 flex justify-between items-center shadow-md z-10">
                <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <LifeBuoy className="w-6 h-6 text-ocean-500" />
                        Skipper AI
                    </h2>
                    <p className="text-[10px] text-ocean-400 flex items-center gap-1">
                        <UserCog className="w-3 h-3" /> {persona} Mode
                    </p>
                </div>
                <button 
                    onClick={() => setViewMode('architect')}
                    className="p-2 bg-ocean-800 rounded-lg text-ocean-400 hover:text-white border border-ocean-700 transition-colors"
                    title="Configure AI"
                >
                    <UserCog className="w-5 h-5" />
                </button>
            </div>

            {/* Chat Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((msg) => (
                    <div 
                        key={msg.id} 
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                        <div 
                            className={`max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
                                msg.role === 'user' 
                                    ? 'bg-ocean-500 text-white rounded-br-none' 
                                    : 'bg-ocean-800 text-gray-200 rounded-bl-none border border-ocean-700'
                            }`}
                        >
                            {msg.text}
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-ocean-800 p-3 rounded-2xl rounded-bl-none border border-ocean-700">
                            <div className="flex gap-1">
                                <div className="w-2 h-2 bg-ocean-400 rounded-full animate-bounce"></div>
                                <div className="w-2 h-2 bg-ocean-400 rounded-full animate-bounce delay-75"></div>
                                <div className="w-2 h-2 bg-ocean-400 rounded-full animate-bounce delay-150"></div>
                            </div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Quick Chips (Context Aware) */}
            {messages.length < 3 && (
                 <div className="px-4 pb-2 flex gap-2 overflow-x-auto no-scrollbar">
                    <button onClick={() => setInput("Check my anchor scope calculation")} className="flex-shrink-0 bg-ocean-800 text-ocean-300 px-3 py-2 rounded-full text-xs border border-ocean-700 whitespace-nowrap">
                        Verify Scope
                    </button>
                    <button onClick={() => setInput(`Is ${seabedType} safe for my anchor?`)} className="flex-shrink-0 bg-ocean-800 text-ocean-300 px-3 py-2 rounded-full text-xs border border-ocean-700 whitespace-nowrap">
                        Check Seabed
                    </button>
                </div>
            )}

            {/* Input Area */}
            <div className="p-4 bg-ocean-900 border-t border-ocean-800">
                <div className="flex gap-2 relative">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        placeholder={`Ask ${persona}...`}
                        className="w-full bg-ocean-800 border border-ocean-700 text-white rounded-full pl-4 pr-12 py-3 focus:outline-none focus:ring-1 focus:ring-ocean-500 placeholder:text-ocean-600"
                    />
                    <button 
                        onClick={handleSend}
                        disabled={isLoading || !input.trim()}
                        className="absolute right-1 top-1 p-2 bg-ocean-500 rounded-full text-white disabled:opacity-50 disabled:bg-ocean-700 transition-transform active:scale-95"
                    >
                        <Send className="w-5 h-5" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AIAssistant;