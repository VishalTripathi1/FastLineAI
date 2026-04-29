"use client";
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Footer } from "./components/Footer";

// Country codes with flags
const countries = [
    { code: "+1", flag: "🇺🇸", name: "US/CA" },
    { code: "+44", flag: "🇬🇧", name: "UK" },
    { code: "+91", flag: "🇮🇳", name: "India" },
    { code: "+86", flag: "🇨🇳", name: "China" },
    { code: "+81", flag: "🇯🇵", name: "Japan" },
    { code: "+49", flag: "🇩🇪", name: "Germany" },
    { code: "+33", flag: "🇫🇷", name: "France" },
    { code: "+39", flag: "🇮🇹", name: "Italy" },
    { code: "+34", flag: "🇪🇸", name: "Spain" },
    { code: "+61", flag: "🇦🇺", name: "Australia" },
    { code: "+64", flag: "🇳🇿", name: "New Zealand" },
    { code: "+27", flag: "🇿🇦", name: "South Africa" },
    { code: "+55", flag: "🇧🇷", name: "Brazil" },
    { code: "+52", flag: "🇲🇽", name: "Mexico" },
    { code: "+7", flag: "🇷🇺", name: "Russia" },
    { code: "+82", flag: "🇰🇷", name: "South Korea" },
    { code: "+65", flag: "🇸🇬", name: "Singapore" },
    { code: "+971", flag: "🇦🇪", name: "UAE" },
    { code: "+966", flag: "🇸🇦", name: "Saudi Arabia" },
    { code: "+31", flag: "🇳🇱", name: "Netherlands" },
    { code: "+46", flag: "🇸🇪", name: "Sweden" },
    { code: "+47", flag: "🇳🇴", name: "Norway" },
    { code: "+45", flag: "🇩🇰", name: "Denmark" },
    { code: "+41", flag: "🇨🇭", name: "Switzerland" },
    { code: "+32", flag: "🇧🇪", name: "Belgium" },
    { code: "+351", flag: "🇵🇹", name: "Portugal" },
    { code: "+353", flag: "🇮🇪", name: "Ireland" },
    { code: "+48", flag: "🇵🇱", name: "Poland" },
    { code: "+90", flag: "🇹🇷", name: "Turkey" },
    { code: "+20", flag: "🇪🇬", name: "Egypt" },
    { code: "+234", flag: "🇳🇬", name: "Nigeria" },
    { code: "+254", flag: "🇰🇪", name: "Kenya" },
    { code: "+62", flag: "🇮🇩", name: "Indonesia" },
    { code: "+60", flag: "🇲🇾", name: "Malaysia" },
    { code: "+66", flag: "🇹🇭", name: "Thailand" },
    { code: "+84", flag: "🇻🇳", name: "Vietnam" },
    { code: "+63", flag: "🇵🇭", name: "Philippines" },
    { code: "+92", flag: "🇵🇰", name: "Pakistan" },
    { code: "+880", flag: "🇧🇩", name: "Bangladesh" },
    { code: "+94", flag: "🇱🇰", name: "Sri Lanka" },
];

// Emergency training scenarios (must match backend EMERGENCY_SCENARIOS)
const SCENARIOS = [
    {
        id: 1,
        name: "Heart Attack — Elderly Man Calling for Wife",
        category: "Medical",
        difficulty: "Medium",
        description: "A 72-year-old man's wife has collapsed with chest pain. He is panicked and needs you to guide him through getting help.",
        icon: "🫀",
    },
    {
        id: 2,
        name: "House Fire — Mother with Children Trapped",
        category: "Fire",
        difficulty: "Hard",
        description: "A mother escaped with one child but her 7-year-old son is still trapped upstairs. Flames visible, caller is hysterical.",
        icon: "🔥",
    },
    {
        id: 3,
        name: "Car Accident — Highway Multi-Vehicle Crash",
        category: "Accident",
        difficulty: "Medium",
        description: "A bystander reports a 4-car pile-up on the interstate. Multiple injuries, one person unconscious, smoke from engine.",
        icon: "🚗",
    },
    {
        id: 4,
        name: "Home Invasion — Intruder in the House",
        category: "Crime",
        difficulty: "Hard",
        description: "A woman hiding in her closet at 2:30 AM whispering — someone broke in downstairs. She is terrified.",
        icon: "🚨",
    },
    {
        id: 5,
        name: "Drowning Child — Pool Emergency",
        category: "Medical",
        difficulty: "Hard",
        description: "A father's 6-year-old son pulled from pool, not breathing, lips turning blue. Bystander attempting CPR.",
        icon: "🏊",
    },
];

interface AnalysisResult {
    scenario: string;
    overall_rating: {
        score: number;
        summary: string;
    };
    strengths: string[];
    areas_for_improvement: string[];
    information_handling: {
        gathered_correctly: string[];
        missed_or_incorrect: string[];
    };
    action_assessment: {
        appropriate_actions: string[];
        inappropriate_actions: string[];
    };
    efficiency: {
        response_time_rating: number;
        comments: string;
    };
    final_recommendation: string;
    pass_fail: "PASS" | "FAIL";
    callSid?: string;
}

const difficultyColor: Record<string, string> = {
    Easy: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    Medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    Hard: "bg-red-500/20 text-red-400 border-red-500/30",
};

const categoryColor: Record<string, string> = {
    Medical: "text-sky-400",
    Fire: "text-orange-400",
    Accident: "text-yellow-400",
    Crime: "text-purple-400",
};

export default function Home() {
    const [phoneNumber, setPhoneNumber] = useState("");
    const [selectedCountry, setSelectedCountry] = useState(countries[1]); // Default to UK (+44)
    const [isCountryDropdownOpen, setIsCountryDropdownOpen] = useState(false);
    const [countrySearch, setCountrySearch] = useState("");
    const [highlightedCountryIndex, setHighlightedCountryIndex] = useState(0);
    const countryListRef = useRef<HTMLDivElement>(null);
    const highlightedOptionRef = useRef<HTMLButtonElement | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [callStatus, setCallStatus] = useState<"idle" | "calling" | "in-progress" | "analyzing" | "completed">("idle");
    const [currentCallSid, setCurrentCallSid] = useState<string | null>(null);
    const [lastAnalysis, setLastAnalysis] = useState<AnalysisResult | null>(null);
    const [isClient, setIsClient] = useState(false);
    const [selectedScenario, setSelectedScenario] = useState<number | null>(null);

    // Client-side only initialization
    useEffect(() => {
        setIsClient(true);
    }, []);

    // Filtered countries for search and keyboard nav
    const filteredCountries = useMemo(() => {
        const search = countrySearch.toLowerCase().trim();
        if (!search) return countries;
        return countries.filter(
            (c) =>
                c.name.toLowerCase().includes(search) ||
                c.code.includes(search) ||
                c.code.replace(/\D/g, "").includes(search)
        );
    }, [countrySearch]);

    // When dropdown opens, set highlighted index to selected country (or 0)
    useEffect(() => {
        if (isCountryDropdownOpen) {
            const idx = filteredCountries.findIndex((c) => c.code === selectedCountry.code);
            setHighlightedCountryIndex(idx >= 0 ? idx : 0);
        }
    }, [isCountryDropdownOpen, selectedCountry.code, filteredCountries]);

    // Keyboard navigation for dropdown
    useEffect(() => {
        if (!isCountryDropdownOpen) return;
        const len = filteredCountries.length;
        if (len === 0) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            const isSearchFocused = target.getAttribute("data-country-search") === "true";
            if (isSearchFocused && e.key !== "Escape" && e.key !== "Enter" && e.key !== "ArrowDown" && e.key !== "ArrowUp") {
                return;
            }

            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault();
                    setHighlightedCountryIndex((i) => (i + 1) % len);
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    setHighlightedCountryIndex((i) => (i - 1 + len) % len);
                    break;
                case "Enter":
                    e.preventDefault();
                    setSelectedCountry(filteredCountries[highlightedCountryIndex]);
                    setIsCountryDropdownOpen(false);
                    setCountrySearch("");
                    break;
                case "Escape":
                    e.preventDefault();
                    setIsCountryDropdownOpen(false);
                    setCountrySearch("");
                    break;
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [isCountryDropdownOpen, filteredCountries, highlightedCountryIndex]);

    // Close country dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (isCountryDropdownOpen) {
                const target = event.target as HTMLElement;
                if (!target.closest(".country-selector-container")) {
                    setIsCountryDropdownOpen(false);
                    setCountrySearch("");
                }
            }
        };
        if (isCountryDropdownOpen) {
            document.addEventListener("mousedown", handleClickOutside);
            return () => document.removeEventListener("mousedown", handleClickOutside);
        }
    }, [isCountryDropdownOpen]);

    // Poll for analysis when a call is in progress
    useEffect(() => {
        if (!currentCallSid || callStatus === "idle" || callStatus === "completed") return;

        const startTime = Date.now();
        const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

        const interval = setInterval(async () => {
            // Auto-reset if polling too long (call ended but analysis never arrived)
            if (Date.now() - startTime > POLL_TIMEOUT_MS) {
                console.log("Polling timeout reached, resetting call status");
                setCallStatus("idle");
                setCurrentCallSid(null);
                setSubmitError("Call timed out waiting for analysis. The call may have ended — you can start a new simulation.");
                return;
            }

            try {
                const res = await fetch(`/api/analysis?callSid=${currentCallSid}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.scenario) {
                        setLastAnalysis(data);
                        setCallStatus("completed");
                        setCurrentCallSid(null); // Stop polling
                    }
                }
            } catch (e) {
                console.error("Polling error:", e);
            }
        }, 5000);

        return () => clearInterval(interval);
    }, [currentCallSid, callStatus]);


    const handleStartSimulation = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setSubmitError(null);
        setLastAnalysis(null);

        // Phone number validation
        let formattedNumber = phoneNumber.trim();
        if (!formattedNumber) {
            setSubmitError("Please enter a phone number");
            setIsSubmitting(false);
            return;
        }

        const digitsOnly = formattedNumber.replace(/\D/g, "");
        formattedNumber = selectedCountry.code + digitsOnly;

        const phoneRegex = /^\+[1-9]\d{1,14}$/;
        if (!phoneRegex.test(formattedNumber)) {
            setSubmitError(`Invalid phone format for ${selectedCountry.name}`);
            setIsSubmitting(false);
            return;
        }

        try {
            const response = await fetch("/api/outbound-call", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    number: formattedNumber,
                    scenarioId: selectedScenario,
                }),
            });

            if (response.ok) {
                const data = await response.json();
                console.log("Call initiated:", data);
                setCurrentCallSid(data.callSid);
                setCallStatus("in-progress");
            } else {
                const errText = await response.text();
                setSubmitError(`Failed to start call: ${errText}`);
            }
        } catch (error) {
            setSubmitError("Network error. Check backend connection.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const activeScenario = SCENARIOS.find((s) => s.id === selectedScenario);

    return (
        <div className="min-h-screen bg-black text-white p-6 md:p-8 flex flex-col items-center">

            {/* Header */}
            <header className="w-full text-center pt-12 pb-8">
                <h1 className="text-[2.75rem] md:text-6xl font-bold tracking-tight">
                    FirstLine<span className="text-blue-500">AI</span>
                </h1>
                <p className="mt-4 text-sm uppercase tracking-widest text-zinc-500">
                    Emergency Dispatcher Training Simulator
                </p>
                <p className="mt-2 text-zinc-400 text-sm max-w-xl mx-auto">
                    Practice handling real-world 911 calls. The AI plays a panicked emergency caller — <strong className="text-white">you</strong> are the dispatcher.
                </p>
            </header>

            {/* Scenario Selection */}
            <section className="w-full max-w-4xl mb-8">
                <h2 className="text-lg font-semibold mb-4 text-zinc-300">Choose a Training Scenario</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {SCENARIOS.map((scenario) => (
                        <button
                            key={scenario.id}
                            id={`scenario-${scenario.id}`}
                            type="button"
                            onClick={() => setSelectedScenario(selectedScenario === scenario.id ? null : scenario.id)}
                            className={`text-left p-5 rounded-xl border transition-all duration-200 ${selectedScenario === scenario.id
                                ? "bg-blue-600/10 border-blue-500 shadow-lg shadow-blue-900/20 scale-[1.02]"
                                : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900"
                                }`}
                        >
                            <div className="flex items-center gap-3 mb-3">
                                <span className="text-2xl">{scenario.icon}</span>
                                <div className="flex gap-2">
                                    <span className={`text-xs px-2 py-0.5 rounded-full border ${difficultyColor[scenario.difficulty]}`}>
                                        {scenario.difficulty}
                                    </span>
                                    <span className={`text-xs font-medium ${categoryColor[scenario.category]}`}>
                                        {scenario.category}
                                    </span>
                                </div>
                            </div>
                            <h3 className="font-semibold text-sm text-white mb-1">{scenario.name}</h3>
                            <p className="text-xs text-zinc-500 leading-relaxed">{scenario.description}</p>
                        </button>
                    ))}

                    {/* Random scenario option */}
                    <button
                        type="button"
                        id="scenario-random"
                        onClick={() => setSelectedScenario(null)}
                        className={`text-left p-5 rounded-xl border transition-all duration-200 ${selectedScenario === null
                            ? "bg-blue-600/10 border-blue-500 shadow-lg shadow-blue-900/20 scale-[1.02]"
                            : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900"
                            }`}
                    >
                        <div className="flex items-center gap-3 mb-3">
                            <span className="text-2xl">🎲</span>
                            <span className="text-xs px-2 py-0.5 rounded-full border bg-zinc-700/30 text-zinc-400 border-zinc-600">
                                Surprise
                            </span>
                        </div>
                        <h3 className="font-semibold text-sm text-white mb-1">Random Scenario</h3>
                        <p className="text-xs text-zinc-500 leading-relaxed">
                            Get a random emergency — test your ability to adapt without preparation.
                        </p>
                    </button>
                </div>
            </section>

            {/* Main Action Card */}
            <section className="w-full max-w-lg">
                <div className="bg-zinc-900/50 backdrop-blur-lg border border-zinc-800 rounded-2xl p-8 shadow-2xl">
                    <h2 className="text-2xl font-semibold mb-2 text-center">Start Training Call</h2>
                    <p className="text-zinc-400 text-center mb-2 text-sm">
                        {activeScenario
                            ? <>Scenario: <strong className="text-white">{activeScenario.name}</strong></>
                            : <>A <strong className="text-white">random emergency caller</strong> will call you.</>
                        }
                    </p>
                    <p className="text-zinc-500 text-center mb-6 text-xs">
                        Answer the call and handle the emergency as a professional dispatcher.
                    </p>

                    <form onSubmit={handleStartSimulation} className="flex flex-col gap-4">
                        <div className="relative flex">
                            {/* Country Code Selector */}
                            <div className="relative country-selector-container z-20">
                                <button
                                    type="button"
                                    onClick={() => setIsCountryDropdownOpen(!isCountryDropdownOpen)}
                                    className="flex items-center gap-2 px-4 py-4 rounded-l-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 transition"
                                >
                                    <span className="text-xl">{selectedCountry.flag}</span>
                                    <span className="text-sm font-medium">{selectedCountry.code}</span>
                                </button>

                                {isCountryDropdownOpen && (
                                    <div className="absolute top-full left-0 mt-1 w-64 max-h-64 overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl">
                                        <div className="p-2 sticky top-0 bg-zinc-900 z-10">
                                            <input
                                                data-country-search="true"
                                                type="text"
                                                placeholder="Search..."
                                                value={countrySearch}
                                                onChange={(e) => setCountrySearch(e.target.value)}
                                                className="w-full px-3 py-2 bg-zinc-800 rounded-lg text-sm border-none focus:ring-1 focus:ring-blue-500"
                                                autoFocus
                                            />
                                        </div>
                                        {filteredCountries.map((country, index) => (
                                            <button
                                                key={country.code}
                                                type="button"
                                                onClick={() => {
                                                    setSelectedCountry(country);
                                                    setIsCountryDropdownOpen(false);
                                                    setCountrySearch("");
                                                }}
                                                className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-zinc-800 ${index === highlightedCountryIndex ? "bg-zinc-800" : ""
                                                    }`}
                                            >
                                                <span className="text-xl">{country.flag}</span>
                                                <span className="text-sm flex-1">{country.name}</span>
                                                <span className="text-xs text-zinc-500">{country.code}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <input
                                type="tel"
                                value={phoneNumber}
                                onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ""))}
                                placeholder="Your phone number"
                                className="flex-1 px-4 py-4 rounded-r-xl border border-zinc-700 border-l-0 bg-zinc-900/50 text-lg placeholder-zinc-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting || callStatus === "in-progress"}
                            className={`w-full py-4 rounded-xl font-bold text-lg transition-all transform ${isSubmitting || callStatus === "in-progress"
                                ? "bg-zinc-700 cursor-not-allowed text-zinc-400"
                                : "bg-blue-600 hover:bg-blue-500 hover:scale-[1.02] shadow-lg shadow-blue-900/20"
                                }`}
                        >
                            {isSubmitting ? "Initiating..." : callStatus === "in-progress" ? "📞 Call in Progress..." : "Start Training Call"}
                        </button>

                        {callStatus === "in-progress" && (
                            <div className="text-center">
                                <p className="text-amber-400 text-sm mb-3 in-call-indicator">
                                    📞 You will receive a call shortly. Answer it and handle the emergency!
                                </p>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setCallStatus("idle");
                                        setCurrentCallSid(null);
                                        setSubmitError(null);
                                    }}
                                    className="w-full py-3 rounded-xl font-medium text-sm border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 transition-all"
                                >
                                    ↻ Start New Call
                                </button>
                            </div>
                        )}

                        {submitError && (
                            <div className="bg-red-900/20 border border-red-800/50 text-red-200 p-3 rounded-lg text-center text-sm">
                                {submitError}
                            </div>
                        )}
                    </form>
                </div>
            </section>

            {/* Analysis Results — Trainee Performance Report */}
            {lastAnalysis && (
                <section className="w-full max-w-4xl mt-12 animate-fade-in">
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
                        <div className={`p-6 border-b border-zinc-800 ${lastAnalysis.pass_fail === 'PASS' ? 'bg-green-900/10' : 'bg-red-900/10'}`}>
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-2xl font-bold text-white mb-1">Trainee Performance Report</h3>
                                    <p className="text-zinc-400 text-sm">Scenario: <span className="text-white font-medium">{lastAnalysis.scenario}</span></p>
                                </div>
                                <div className={`px-4 py-2 rounded-full font-bold text-xl border ${lastAnalysis.pass_fail === 'PASS'
                                    ? 'bg-green-500/20 text-green-400 border-green-500/30'
                                    : 'bg-red-500/20 text-red-400 border-red-500/30'
                                    }`}>
                                    {lastAnalysis.pass_fail} • {lastAnalysis.overall_rating.score}/10
                                </div>
                            </div>
                            <p className="text-zinc-300 text-sm mt-2">{lastAnalysis.overall_rating.summary}</p>
                        </div>

                        <div className="p-8 grid md:grid-cols-2 gap-8">
                            <div>
                                <h4 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-4">Your Strengths</h4>
                                <ul className="space-y-2">
                                    {lastAnalysis.strengths.map((item, i) => (
                                        <li key={i} className="flex items-start gap-2 text-zinc-300 text-sm">
                                            <span className="text-green-500 mt-1">✓</span> {item}
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <div>
                                <h4 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-4">Areas to Improve</h4>
                                <ul className="space-y-2">
                                    {lastAnalysis.areas_for_improvement.map((item, i) => (
                                        <li key={i} className="flex items-start gap-2 text-zinc-300 text-sm">
                                            <span className="text-yellow-500 mt-1">!</span> {item}
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <div className="md:col-span-2 mt-4 pt-6 border-t border-zinc-800">
                                <h4 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-2">Recommendation</h4>
                                <p className="text-zinc-300 leading-relaxed">{lastAnalysis.final_recommendation}</p>
                            </div>
                        </div>
                    </div>
                </section>
            )}

            <Footer />
        </div>
    );
}
