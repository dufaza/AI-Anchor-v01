
import React, { useState, useEffect } from 'react';
import { Sailboat, Ruler, Pencil, Ship, ArrowUpFromLine, Expand, Anchor, Link, Weight, Search, Loader2, Sparkles, Info } from 'lucide-react';
import { BoatData } from '../types';
import { getBoatSpecs } from '../services/geminiService';

interface BoatSettingsProps {
    boatData: BoatData;
    setBoatData: React.Dispatch<React.SetStateAction<BoatData>>;
}

const BoatSettings: React.FC<BoatSettingsProps> = ({ boatData, setBoatData }) => {
    const [isSearching, setIsSearching] = useState(false);
    
    // Automatic initialization for default model
    useEffect(() => {
        const initDefaultBoat = async () => {
            if (boatData.model === 'Dufour 390 GL' && boatData.length === 0) {
                try {
                    const specs = await getBoatSpecs(boatData.model);
                    if (specs) {
                        setBoatData(prev => ({
                            ...prev,
                            length: specs.length || prev.length,
                            beam: specs.beam || prev.beam,
                            draft: specs.draft || prev.draft,
                            bowHeight: specs.bowHeight || prev.bowHeight,
                            displacement: specs.displacement || prev.displacement,
                        }));
                    }
                } catch (e) {
                    console.log("Silent Init Failed");
                }
            }
        };

        initDefaultBoat();
    }, []);

    const handleChange = (key: keyof BoatData, value: string | number) => {
        setBoatData(prev => ({
            ...prev,
            [key]: value
        }));
    };

    const handleAutoFill = async () => {
        if (!boatData.model || boatData.model.length < 3) {
            alert("Please enter a boat model name first (e.g., 'Dufour 390').");
            return;
        }

        setIsSearching(true);
        try {
            const specs = await getBoatSpecs(boatData.model);
            
            if (specs) {
                setBoatData(prev => ({
                    ...prev,
                    length: specs.length || prev.length,
                    beam: specs.beam || prev.beam,
                    draft: specs.draft || prev.draft,
                    displacement: specs.displacement || prev.displacement,
                    bowHeight: specs.bowHeight || prev.bowHeight,
                    anchorWeight: specs.anchorWeight || prev.anchorWeight,
                    chainDiameter: specs.chainDiameter || prev.chainDiameter
                }));
            } else {
                alert(`Could not find specifications for "${boatData.model}".\n\nPlease check the spelling or enter values manually.`);
            }
        } catch (e: any) {
            if (e.message === "MISSING_KEY") {
                alert("Setup Required: The API Key is missing on this device.\n\nIf you are using Vercel, please add 'API_KEY' to your Environment Variables in the Project Settings.");
            } else {
                alert(`Connection error: ${e.message || "Unknown error"}. Please check your internet.`);
            }
        } finally {
            setIsSearching(false);
        }
    };

    // Style constants matched to ScopeCalculator for consistency and compactness
    const labelStyle = "block text-xs font-bold text-ocean-400 uppercase tracking-wider mb-1";
    const inputStyle = "w-full bg-ocean-800 border border-ocean-700 rounded-lg p-3 pl-10 text-white focus:ring-2 focus:ring-ocean-500 focus:outline-none transition-all font-mono text-sm";
    const iconStyle = "absolute left-3 top-3.5 w-4 h-4 text-ocean-400";

    return (
        <div className="flex flex-col h-full p-6 space-y-5 overflow-y-auto pb-24 animate-in fade-in duration-300">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-ocean-800 pb-2">
                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                    <Sailboat className="w-6 h-6 text-ocean-500" />
                    My Boat
                </h2>
                <div className="px-3 py-1 bg-ocean-800 rounded-full border border-ocean-700">
                    <span className="text-xs text-ocean-300 font-mono">Profile</span>
                </div>
            </div>

            {/* Identity Section */}
            <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3">
                    {/* Name */}
                    <div>
                        <label className={labelStyle}>Boat Name</label>
                        <div className="relative">
                            <Pencil className={iconStyle} />
                            <input
                                type="text"
                                value={boatData.name}
                                onChange={(e) => handleChange('name', e.target.value)}
                                placeholder="e.g. Black Pearl"
                                className={inputStyle}
                            />
                        </div>
                    </div>

                    {/* Model & Search */}
                    <div>
                        <label className={labelStyle}>Model</label>
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <Ship className={iconStyle} />
                                <input
                                    type="text"
                                    value={boatData.model}
                                    onChange={(e) => handleChange('model', e.target.value)}
                                    placeholder="e.g. Dufour 390 GL"
                                    className={inputStyle}
                                    onKeyDown={(e) => e.key === 'Enter' && handleAutoFill()}
                                />
                            </div>
                            <button 
                                onClick={handleAutoFill}
                                disabled={isSearching}
                                className="bg-ocean-600 hover:bg-ocean-500 text-white px-4 rounded-lg border border-ocean-500 transition-colors flex items-center justify-center"
                                title="Auto-fill specs"
                            >
                                {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                            </button>
                        </div>
                        <p className="text-[10px] text-ocean-400 mt-1 flex items-center gap-1">
                            <Sparkles className="w-3 h-3" /> Auto-fill dimensions from web
                        </p>
                    </div>
                </div>
            </div>

            {/* Dimensions Section */}
            <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={labelStyle}>Length (m)</label>
                        <div className="relative">
                            <Ruler className={iconStyle} />
                            <input
                                type="number"
                                value={boatData.length || ''}
                                onChange={(e) => handleChange('length', parseFloat(e.target.value))}
                                className={inputStyle}
                                step="0.1"
                            />
                        </div>
                    </div>

                    <div>
                        <label className={labelStyle}>Beam (m)</label>
                        <div className="relative">
                            <Expand className={iconStyle} />
                            <input
                                type="number"
                                value={boatData.beam || ''}
                                onChange={(e) => handleChange('beam', parseFloat(e.target.value))}
                                className={inputStyle}
                                step="0.1"
                            />
                        </div>
                    </div>

                    <div>
                        <label className={labelStyle}>Draft (m)</label>
                        <div className="relative">
                            <ArrowUpFromLine className={iconStyle} />
                            <input
                                type="number"
                                value={boatData.draft || ''}
                                onChange={(e) => handleChange('draft', parseFloat(e.target.value))}
                                className={inputStyle}
                                step="0.1"
                            />
                        </div>
                    </div>

                    <div>
                        <label className={`${labelStyle} text-ocean-300`}>Bow Height (m)</label>
                        <div className="relative">
                            <ArrowUpFromLine className={`${iconStyle} text-ocean-300`} />
                            <input
                                type="number"
                                value={boatData.bowHeight || ''}
                                onChange={(e) => handleChange('bowHeight', parseFloat(e.target.value))}
                                className={`${inputStyle} border-ocean-500/30 bg-ocean-800/80 font-bold text-ocean-100`}
                                step="0.1"
                            />
                        </div>
                    </div>

                    <div className="col-span-2">
                        <label className={labelStyle}>Displacement (kg)</label>
                        <div className="relative">
                            <Weight className={iconStyle} />
                            <input
                                type="number"
                                value={boatData.displacement || ''}
                                onChange={(e) => handleChange('displacement', parseFloat(e.target.value))}
                                className={inputStyle}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* My Anchor Section */}
            <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between border-b border-ocean-800 pb-2">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                        <Anchor className="w-6 h-6 text-ocean-500" />
                        My Anchor
                    </h2>
                </div>
            
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={labelStyle}>Anchor (kg)</label>
                        <div className="relative">
                            <Anchor className={iconStyle} />
                            <input
                                type="number"
                                value={boatData.anchorWeight || ''}
                                onChange={(e) => handleChange('anchorWeight', parseFloat(e.target.value))}
                                className={inputStyle}
                            />
                        </div>
                    </div>

                    <div>
                        <label className={labelStyle}>Chain (m)</label>
                        <div className="relative">
                            <Link className={iconStyle} />
                            <input
                                type="number"
                                value={boatData.chainTotalLength || ''}
                                onChange={(e) => handleChange('chainTotalLength', parseFloat(e.target.value))}
                                className={inputStyle}
                            />
                        </div>
                    </div>

                    <div>
                        <label className={labelStyle}>Diam (mm)</label>
                        <div className="relative">
                            <Ruler className={iconStyle} />
                            <input
                                type="number"
                                value={boatData.chainDiameter || ''}
                                onChange={(e) => handleChange('chainDiameter', parseFloat(e.target.value))}
                                className={inputStyle}
                            />
                        </div>
                    </div>

                    <div>
                        <label className={labelStyle}>Wt (kg/m)</label>
                        <div className="relative">
                            <Weight className={iconStyle} />
                            <input
                                type="number"
                                value={boatData.chainWeight || ''}
                                onChange={(e) => handleChange('chainWeight', parseFloat(e.target.value))}
                                className={inputStyle}
                                step="0.1"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BoatSettings;
