import React from 'react';
import { Wind, Anchor, LifeBuoy, Settings, ScanEye, MapPin, Ruler, Sailboat } from 'lucide-react';
import { AppTab } from '../types';

interface NavigationProps {
    currentTab: AppTab;
    setTab: (tab: AppTab) => void;
}

const Navigation: React.FC<NavigationProps> = ({ currentTab, setTab }) => {
    const btnClass = (tab: AppTab) => 
        `flex flex-col items-center justify-center flex-1 h-full space-y-1 transition-colors min-w-[45px] ${currentTab === tab ? 'text-ocean-400' : 'text-gray-500'}`;

    const iconClass = (tab: AppTab) => 
        `w-5 h-5 ${currentTab === tab ? 'fill-current opacity-20 stroke-2' : 'stroke-2'}`;

    return (
        <nav className="fixed bottom-0 left-0 right-0 bg-ocean-900/95 backdrop-blur-md border-t border-ocean-800 pb-safe z-50">
            <div className="flex justify-between items-center h-16 max-w-md mx-auto px-1 overflow-x-auto no-scrollbar">
                
                {/* 1. Boat */}
                <button onClick={() => setTab(AppTab.BOAT)} className={btnClass(AppTab.BOAT)}>
                    <Sailboat className={iconClass(AppTab.BOAT)} />
                    <span className="text-[9px] font-medium">Boat</span>
                </button>

                {/* 2. Sea & Wind (Renamed) */}
                <button onClick={() => setTab(AppTab.CALCULATOR)} className={btnClass(AppTab.CALCULATOR)}>
                    <Wind className={iconClass(AppTab.CALCULATOR)} />
                    <span className="text-[9px] font-medium">Sea & Wind</span>
                </button>

                {/* 3. Bluetooth & Sensors */}
                <button onClick={() => setTab(AppTab.SETTINGS)} className={btnClass(AppTab.SETTINGS)}>
                    <Settings className={iconClass(AppTab.SETTINGS)} />
                    <span className="text-[9px] font-medium">Sensors</span>
                </button>

                {/* 4. Calibration */}
                <button onClick={() => setTab(AppTab.CALIBRATION)} className={btnClass(AppTab.CALIBRATION)}>
                    <Ruler className={iconClass(AppTab.CALIBRATION)} />
                    <span className="text-[9px] font-medium">Calib.</span>
                </button>

                {/* 5. Positioning */}
                <button onClick={() => setTab(AppTab.POSITIONING)} className={btnClass(AppTab.POSITIONING)}>
                    <Anchor className={iconClass(AppTab.POSITIONING)} />
                    <span className="text-[9px] font-medium">Pos.</span>
                </button>

                {/* 6. Monitoring */}
                <button onClick={() => setTab(AppTab.MONITORING)} className={btnClass(AppTab.MONITORING)}>
                    <ScanEye className={iconClass(AppTab.MONITORING)} />
                    <span className="text-[9px] font-medium">Monitor</span>
                </button>

                {/* 7. Watch */}
                <button onClick={() => setTab(AppTab.WATCH)} className={btnClass(AppTab.WATCH)}>
                    <MapPin className={iconClass(AppTab.WATCH)} />
                    <span className="text-[9px] font-medium">Watch</span>
                </button>

                {/* 8. Skipper */}
                <button onClick={() => setTab(AppTab.ASSISTANT)} className={btnClass(AppTab.ASSISTANT)}>
                    <LifeBuoy className={iconClass(AppTab.ASSISTANT)} />
                    <span className="text-[9px] font-medium">Skipper</span>
                </button>
            </div>
        </nav>
    );
};

export default Navigation;