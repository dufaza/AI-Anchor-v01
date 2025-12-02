import { BoatData } from "../types";

// Robustly retrieve API Key from either process.env (legacy/AI Studio) or import.meta.env (Vite/Vercel)
// @ts-ignore
const API_KEY = process.env.API_KEY || import.meta.env?.VITE_API_KEY;

const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

export const getSailingAdvice = async (prompt: string, systemInstruction?: string): Promise<string> => {
    if (!API_KEY) {
        console.error("GeminiService: API_KEY is missing. Check Vercel Environment Variables.");
        return "Configuration Error: API Key is missing. If you are on Vercel, add 'API_KEY' to Environment Variables.";
    }

    try {
        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined
        };

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "No advice available at the moment.";
    } catch (error) {
        console.error("Gemini API Advice Error:", error);
        return "Unable to fetch advice. Please check your connection.";
    }
};

export const getBoatSpecs = async (modelName: string): Promise<Partial<BoatData> | null> => {
    if (!API_KEY) {
        console.error("GeminiService: API_KEY is missing/undefined.");
        // Throwing a specific string that BoatSettings can catch and display
        throw new Error("MISSING_KEY");
    }
 
    try {
        console.log(`GeminiService: Fetching specs for ${modelName}...`);
        
        const prompt = `
        Act as a maritime technical database.
        Find the technical specifications for the boat model: "${modelName}".
        
        Return ONLY a JSON object with the following keys (numbers only, no units):
        - length (LOA in meters)
        - beam (Width in meters)
        - draft (Max draft in meters)
        - displacement (Light displacement in kg)
        - bowHeight (Approximate freeboard at bow in meters, default to 1.2 if unknown)
        - anchorWeight (Recommended anchor weight in kg)
        - chainDiameter (Recommended chain diameter in mm)

        Example format:
        {
          "length": 11.5,
          "beam": 3.9,
          "draft": 1.9,
          "displacement": 8500,
          "bowHeight": 1.4,
          "anchorWeight": 20,
          "chainDiameter": 10
        }
        
        Do not add markdown formatting or explanations. Just the JSON.
        `;

        const payload = {
            contents: [{ parts: [{ text: prompt }] }]
        };

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`API Request Failed: ${response.status}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!text) return null;
        
        // Robust cleaning: remove markdown code blocks if present
        const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        console.log("GeminiService: Specs received", cleanedText);
        return JSON.parse(cleanedText);
    } catch (error) {
        console.error("Gemini Boat Specs Error:", error);
        throw error;
    }
};