import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore'; // Removed 'collection' as it was unused

// Main App component
const App = () => {
  // Firebase States
  const [db, setDb] = useState(null);
  // const [auth, setAuth] = useState(null); // 'auth' was assigned but never used, removed state
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false); // To ensure Firestore operations wait for auth

  // Application States
  const [selectedBroadCategories, setSelectedBroadCategories] = useState([]);
  const [skillsByCategory, setSkillsByCategory] = useState({});
  const [newSkillInput, setNewSkillInput] = useState('');
  const [activeBroadCategory, setActiveBroadCategory] = useState('');
  const [activeSubCategory, setActiveSubCategory] = useState('');
  const [newCustomBroadCategory, setNewCustomBroadCategory] = useState('');
  const [suggestedSubCategories, setSuggestedSubCategories] = useState([]);
  const [suggestedSpecificSkills, setSuggestedSpecificSkills] = useState([]);
  const [loadingSubCategories, setLoadingSubCategories] = useState(false);
  const [loadingSpecificSkills, setLoadingSpecificSkills] = useState(false);
  const [loadingAutoCategorization, setLoadingAutoCategorization] = useState(false);
  const [selectedSuggestedSkill, setSelectedSuggestedSkill] = useState('');
  const [savingStatus, setSavingStatus] = useState(''); // Status for saving data

  // Define the broad categories available for selection (6-8 as requested)
  const broadCategories = [
    'Creative & Design',
    'Tech & Digital',
    'Business & Professional',
    'Services & Personal Care',
    'Manual & Trades',
    'Education & Health',
    'Food & Hospitality',
  ];

  // Ref to prevent initial save on mount due to state initialization
  const isInitialMount = useRef(true);

  // --- Firebase Initialization and Auth ---
  useEffect(() => {
    const initializeFirebase = async () => {
      try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'; // 'appId' is now used in doc path
        const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');

        if (Object.keys(firebaseConfig).length === 0) {
          console.error("Firebase config is empty. Cannot initialize Firebase.");
          return;
        }

        const app = initializeApp(firebaseConfig);
        const firestoreDb = getFirestore(app);
        const firebaseAuth = getAuth(app); // Kept for sign-in, but not stored in state if unused elsewhere

        setDb(firestoreDb);
        // setAuth(firebaseAuth); // Removed as it was unused

        // Sign in anonymously or with custom token if available
        if (typeof __initial_auth_token !== 'undefined') {
          await signInWithCustomToken(firebaseAuth, __initial_auth_token);
        } else {
          await signInAnonymously(firebaseAuth);
        }

        // Listen for auth state changes to get the user ID
        onAuthStateChanged(firebaseAuth, (user) => {
          if (user) {
            setUserId(user.uid);
            setIsAuthReady(true); // Auth is ready, can start Firestore ops
            console.log("Firebase Auth Ready. User ID:", user.uid);
          } else {
            setUserId(null);
            setIsAuthReady(false);
            console.log("User logged out or not authenticated.");
          }
        });

      } catch (error) {
        console.error("Error initializing Firebase:", error);
      }
    };

    initializeFirebase();
  }, []); // Run only once on mount

  // --- Firestore Data Loading and Saving ---
  useEffect(() => {
    if (!isAuthReady || !db || !userId) {
      console.log("Waiting for Auth readiness, DB, or User ID for data operations.");
      return;
    }

    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'; // Ensure appId is defined for doc path
    const userSkillsDocRef = doc(db, `artifacts/${appId}/users/${userId}/userSkills/whatSkills`);

    // Load skills on component mount
    const loadSkills = async () => {
      try {
        const docSnap = await getDoc(userSkillsDocRef);
        if (docSnap.exists()) {
          const loadedData = docSnap.data();
          if (loadedData.skills) {
            setSkillsByCategory(loadedData.skills);
            // Re-populate selected broad categories from loaded data
            const loadedBroadCategories = new Set();
            Object.keys(loadedData.skills).forEach(broadCatKey => {
                if (broadCategories.includes(broadCatKey)) { // Check against the original broadCategories
                    loadedBroadCategories.add(broadCatKey);
                } else if (broadCatKey.startsWith('Other_Custom_') || broadCatKey.startsWith('Other_Auto_')) {
                    loadedBroadCategories.add('Other'); // Ensure 'Other' checkbox is checked if custom categories exist
                    // Also add the custom/auto-categorized broad category itself if it's not already in selectedBroadCategories
                    if (!Array.from(selectedBroadCategories).some(c => c === broadCatKey)) {
                        loadedBroadCategories.add(broadCatKey);
                    }
                }
            });
            // Merge with existing selectedBroadCategories to avoid removing manually checked ones
            setSelectedBroadCategories(prev => Array.from(new Set([...prev, ...Array.from(loadedBroadCategories)])));
          }
          console.log("Skills loaded from Firestore.");
        } else {
          console.log("No existing skills data for this user.");
        }
      } catch (error) {
        console.error("Error loading skills from Firestore:", error);
      }
    };

    loadSkills();

    // Set up a real-time listener (optional for this specific use case, but good practice)
    const unsubscribe = onSnapshot(userSkillsDocRef, (docSnap) => {
      if (docSnap.exists() && !isInitialMount.current) { // Prevent re-loading on initial snapshot
        const updatedSkills = docSnap.data().skills;
        setSkillsByCategory(updatedSkills || {});
        console.log("Skills updated via real-time listener.");
      }
    }, (error) => {
      console.error("Error listening to skills document:", error);
    });

    return () => unsubscribe(); // Cleanup listener on component unmount
  }, [isAuthReady, db, userId, selectedBroadCategories]); // Added selectedBroadCategories to dependencies

  // Save skills whenever skillsByCategory changes (debounced for performance)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return; // Skip initial save on mount
    }

    if (!isAuthReady || !db || !userId) {
      console.log("Skipping save: Auth not ready, DB not set, or User ID missing.");
      return;
    }

    const saveSkills = async () => {
      setSavingStatus('Saving...');
      try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'; // Ensure appId is defined
        const userSkillsDocRef = doc(db, `artifacts/${appId}/users/${userId}/userSkills/whatSkills`);
        // Firestore doesn't like empty objects directly in maps for some versions,
        // so ensure sub-categories are only added if they have skills.
        const cleanedSkills = {};
        for (const broadCat in skillsByCategory) {
            const subCats = skillsByCategory[broadCat];
            const cleanedSubCats = {};
            for (const subCat in subCats) {
                if (subCats[subCat] && subCats[subCat].length > 0) {
                    cleanedSubCats[subCat] = subCats[subCat];
                }
            }
            if (Object.keys(cleanedSubCats).length > 0) {
                cleanedSkills[broadCat] = cleanedSubCats;
            }
        }

        await setDoc(userSkillsDocRef, { skills: cleanedSkills }, { merge: true });
        setSavingStatus('Saved!');
        console.log("Skills saved to Firestore.");
      } catch (error) {
        setSavingStatus('Save failed!');
        console.error("Error saving skills to Firestore:", error);
      } finally {
        // Clear saving status after a short delay
        setTimeout(() => setSavingStatus(''), 2000);
      }
    };

    const handler = setTimeout(() => {
      saveSkills();
    }, 500); // Debounce by 500ms

    return () => {
      clearTimeout(handler);
    };
  }, [skillsByCategory, isAuthReady, db, userId]); // Dependencies for saving

  // --- Gemini API Calls (Existing Logic) ---

  // Effect hook to fetch sub-category suggestions when activeBroadCategory changes
  useEffect(() => {
    const fetchSubCategories = async (category) => {
      if (!category || category === 'Other') {
        setSuggestedSubCategories([]);
        return;
      }

      setLoadingSubCategories(true);
      let attempts = 0;
      const maxAttempts = 5;
      const baseDelay = 1000;

      while (attempts < maxAttempts) {
        try {
          const prompt = `List 5-8 common sub-categories within the "${category}" broad category. Provide them as a comma-separated list without numbering, bullet points, or any introductory/concluding text. Example for 'Creative & Design': Graphic Design, Music Production, Illustration, Photography, Video Editing, Writing.`;
          const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
          const payload = { contents: chatHistory };
          const apiKey = ""; // API key provided by Canvas runtime
          const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          const result = await response.json();

          if (result.candidates && result.candidates.length > 0 && result.candidates[0].content && result.candidates[0].content.parts && result.candidates[0].content.parts.length > 0) {
            const text = result.candidates[0].content.parts[0].text;
            const parsed = text.split(',').map(s => s.trim()).filter(s => s.length > 0);
            setSuggestedSubCategories(parsed);
            break;
          } else {
            throw new Error("Invalid API response structure or no content for sub-categories.");
          }
        } catch (error) {
          console.error(`Attempt ${attempts + 1} failed to fetch sub-categories for ${category}:`, error);
          attempts++;
          if (attempts < maxAttempts) {
            const delay = baseDelay * Math.pow(2, attempts - 1);
            await new Promise(res => setTimeout(res, delay));
          }
        }
      }
      setLoadingSubCategories(false);
    };

    fetchSubCategories(activeBroadCategory);
  }, [activeBroadCategory, broadCategories]); // Added broadCategories to dependencies

  // Effect hook to fetch specific skill suggestions when activeSubCategory changes
  useEffect(() => {
    const fetchSpecificSkills = async (broadCat, subCat) => {
      if (!broadCat || !subCat || broadCat === 'Other') {
        setSuggestedSpecificSkills([]);
        return;
      }

      setLoadingSpecificSkills(true);
      let attempts = 0;
      const maxAttempts = 5;
      const baseDelay = 1000;

      while (attempts < maxAttempts) {
        try {
          const prompt = `List 10-15 specific and common skills or services within the "${subCat}" sub-category, which belongs to the "${broadCat}" broad category, that someone might monetize. Provide them as a comma-separated list without numbering, bullet points, or any introductory/concluding text. Example for 'Creative & Design' -> 'Music Production': Songwriting, Mixing, Mastering, Sound Design, Live Performance.`;
          const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
          const payload = { contents: chatHistory };
          const apiKey = ""; // API key provided by Canvas runtime
          const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          const result = await response.json();

          if (result.candidates && result.candidates.length > 0 && result.candidates[0].content && result.candidates[0].content.parts && result.candidates[0].content.parts.length > 0) {
            const text = result.candidates[0].content.parts[0].text;
            const parsed = text.split(',').map(s => s.trim()).filter(s => s.length > 0);
            setSuggestedSpecificSkills(parsed);
            break;
          } else {
            throw new Error("Invalid API response structure or no content for specific skills.");
          }
        } catch (error) {
          console.error(`Attempt ${attempts + 1} failed to fetch specific skills for ${broadCat} - ${subCat}:`, error);
          attempts++;
          if (attempts < maxAttempts) {
            const delay = baseDelay * Math.pow(2, attempts - 1);
            await new Promise(res => setTimeout(res, delay));
          }
        }
      }
      setLoadingSpecificSkills(false);
    };

    fetchSpecificSkills(activeBroadCategory, activeSubCategory);
  }, [activeBroadCategory, activeSubCategory]); // Dependencies

  // --- Handlers for User Input ---

  // Handler for when a broad category checkbox is changed
  const handleBroadCategoryChange = (e) => {
    const { value, checked } = e.target;
    // Check if the value is a standard broad category or 'Other' before modifying selectedBroadCategories
    if (broadCategories.includes(value) || value === 'Other') {
        setSelectedBroadCategories((prev) =>
            checked ? [...prev, value] : prev.filter((cat) => cat !== value)
        );
    }


    // When a category is unchecked, clear its associated skills and selections
    if (!checked) {
      setSkillsByCategory((prev) => {
        const newState = { ...prev };
        delete newState[value];
        // Also remove any custom categories associated with this broad category if unchecked
        Object.keys(newState).forEach(key => {
            if (key.startsWith(`Other_Custom_`) && key.includes(`__${value}`)) { // Adjusted to handle potential naming conventions
                delete newState[key];
            }
             if (key.startsWith(`Other_Auto_`) && key.includes(`__${value}`)) { // Adjusted to handle potential naming conventions
                delete newState[key];
            }
        });
        return newState;
      });
      if (activeBroadCategory === value) {
        setActiveBroadCategory('');
        setActiveSubCategory('');
        setSuggestedSubCategories([]);
        setSuggestedSpecificSkills([]);
      }
    } else {
      setActiveBroadCategory(value); // Set newly checked category as active
      setActiveSubCategory(''); // Reset sub-category when broad category changes
      setSuggestedSpecificSkills([]); // Clear specific skill suggestions
    }
  };

  // Handler for selecting an active broad category from the dropdown (for adding skills)
  const handleActiveBroadCategoryChange = (e) => {
    setActiveBroadCategory(e.target.value);
    setActiveSubCategory(''); // Reset sub-category when broad category changes
    setNewSkillInput(''); // Clear custom skill input
    setSelectedSuggestedSkill(''); // Clear suggested skill selection
    setNewCustomBroadCategory(''); // Clear custom broad category input
  };

  // Handler for selecting an active sub-category from the dropdown
  const handleActiveSubCategoryChange = (e) => {
    setActiveSubCategory(e.target.value);
    setNewSkillInput(''); // Clear custom skill input
    setSelectedSuggestedSkill(''); // Clear suggested skill selection
  };

  // Handler for adding a new skill
  const handleAddSkill = async () => {
    let skillToAdd = selectedSuggestedSkill.trim();
    if (newSkillInput.trim() !== '') {
      skillToAdd = newSkillInput.trim();
    }

    if (skillToAdd === '') return;

    let targetBroadCategory = activeBroadCategory;
    let targetSubCategory = activeSubCategory;

    // Handle 'Other' broad category with custom name
    if (activeBroadCategory === 'Other' && newCustomBroadCategory.trim() !== '') {
        targetBroadCategory = `Other_Custom_${newCustomBroadCategory.trim()}`; // Use unique prefix for custom broad categories
        // If it's a new custom broad category, we need a default sub-category or prompt for one.
        targetSubCategory = 'General';
         if (!selectedBroadCategories.includes(targetBroadCategory)) {
            setSelectedBroadCategories(prev => [...prev, targetBroadCategory]);
        }
    }

    // Auto-categorize if no broad or sub-category is selected for the input skill
    // and if the input skill is not empty
    if ((!targetBroadCategory || !targetSubCategory || targetBroadCategory === 'Other') && newSkillInput.trim() !== '' && !loadingAutoCategorization) {
        setLoadingAutoCategorization(true);
        let attempts = 0;
        const maxAttempts = 5;
        const baseDelay = 1000;

        while (attempts < maxAttempts) {
            try {
                const prompt = `Given the skill "${newSkillInput.trim()}", identify the single most appropriate broad category from this list: [${broadCategories.join(', ')}]. Then, identify one specific sub-category within that broad category that best fits the skill. Provide the response as a JSON object with 'broadCategory' and 'subCategory' keys. If the skill doesn't fit any provided broad category, assign 'Other' as broadCategory and 'Uncategorized' as subCategory. Example: {"broadCategory": "Creative & Design", "subCategory": "Music Production"}`;
                const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
                const payload = {
                    contents: chatHistory,
                    generationConfig: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: "OBJECT",
                            properties: {
                                broadCategory: { "type": "STRING" },
                                subCategory: { "type": "STRING" }
                            }
                        }
                    }
                };
                const apiKey = ""; // API key provided by Canvas runtime
                const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const result = await response.json();

                if (result.candidates && result.candidates.length > 0 && result.candidates[0].content && result.candidates[0].content.parts && result.candidates[0].content.parts.length > 0) {
                    const jsonString = result.candidates[0].content.parts[0].text;
                    const parsedJson = JSON.parse(jsonString);
                    targetBroadCategory = parsedJson.broadCategory;
                    targetSubCategory = parsedJson.subCategory;

                    // If a suggested broad category isn't already selected, add it (or the custom 'Other' if it's new)
                    if (targetBroadCategory === 'Other') {
                        targetBroadCategory = `Other_Auto_Uncategorized`; // Prefix for auto-categorized 'Other'
                        targetSubCategory = parsedJson.subCategory || 'General'; // Use Gemini's subcat or default
                        if (!selectedBroadCategories.includes('Other')) {
                            setSelectedBroadCategories(prev => [...prev, 'Other']); // Keep 'Other' checkbox checked
                        }
                    } else if (!selectedBroadCategories.includes(targetBroadCategory)) {
                        setSelectedBroadCategories(prev => [...prev, targetBroadCategory]);
                    }

                    break; // Success, exit loop
                } else {
                    throw new Error("Invalid API response structure or no content for auto-categorization.");
                }
            } catch (error) {
                console.error(`Attempt ${attempts + 1} failed for auto-categorization of skill "${newSkillInput.trim()}":`, error);
                attempts++;
                if (attempts < maxAttempts) {
                    const delay = baseDelay * Math.pow(2, attempts - 1);
                    await new Promise(res => setTimeout(res, delay));
                }
                // If auto-categorization fails after retries, default to a generic 'Other' -> 'Uncategorized'
                if (attempts === maxAttempts) {
                    targetBroadCategory = 'Other_Auto_Uncategorized'; // Explicitly mark as auto-uncategorized
                    targetSubCategory = 'General';
                    if (!selectedBroadCategories.includes('Other')) {
                        setSelectedBroadCategories(prev => [...prev, 'Other']);
                    }
                }
            }
        }
        setLoadingAutoCategorization(false);
    }

    // Ensure we have a target category structure after all attempts
    if (!targetBroadCategory) {
        console.warn('Cannot add skill: No broad category selected or auto-categorized.');
        setNewSkillInput('');
        setSelectedSuggestedSkill('');
        return;
    }
    if (!targetSubCategory) {
        targetSubCategory = 'General'; // Fallback for sub-category if still missing
    }

    // Prevent duplicate skills within the same sub-category
    if (skillsByCategory[targetBroadCategory]?.[targetSubCategory]?.includes(skillToAdd)) {
        console.warn(`Skill "${skillToAdd}" already exists in "${formatCategoryForDisplay(targetBroadCategory)}" -> "${targetSubCategory}".`);
        setNewSkillInput('');
        setSelectedSuggestedSkill('');
        return;
    }

    setSkillsByCategory((prev) => ({
      ...prev,
      [targetBroadCategory]: {
        ...(prev[targetBroadCategory] || {}),
        [targetSubCategory]: [...(prev[targetBroadCategory]?.[targetSubCategory] || []), skillToAdd],
      },
    }));

    setNewSkillInput(''); // Clear custom input field
    setSelectedSuggestedSkill(''); // Clear dropdown selection
  };

  // Handler for removing a skill
  const handleRemoveSkill = (broadCat, subCat, skillToRemove) => {
    setSkillsByCategory((prev) => {
      const newBroadCatState = { ...prev[broadCat] };
      newBroadCatState[subCat] = newBroadCatState[subCat].filter((skill) => skill !== skillToRemove);

      // If sub-category becomes empty, remove it
      if (newBroadCatState[subCat].length === 0) {
        delete newBroadCatState[subCat];
      }

      // If broad category becomes empty, remove it
      if (Object.keys(newBroadCatState).length === 0) {
        const newState = { ...prev };
        delete newState[broadCat];
        // Also remove from selectedBroadCategories if it was custom/auto-categorized
        if (broadCat.startsWith('Other_Custom_') || broadCat.startsWith('Other_Auto_')) {
            setSelectedBroadCategories(selectedBroadCategories.filter(c => c !== broadCat && c !== 'Other')); // Ensure 'Other' is unchecked if all custom/auto categories are gone
        } else { // Remove from selected if it's a standard category and all its skills are gone
             if (broadCategories.includes(broadCat)) {
                setSelectedBroadCategories(selectedBroadCategories.filter(c => c !== broadCat));
            }
        }
        return newState;
      }
      return { ...prev, [broadCat]: newBroadCatState };
    });
  };

  // Helper function to format category names for display
  const formatCategoryForDisplay = (catKey) => {
      if (catKey.startsWith('Other_Custom_')) {
          return `Custom: ${catKey.replace('Other_Custom_', '')}`;
      }
      if (catKey.startsWith('Other_Auto_Uncategorized')) {
          return `Auto-Uncategorized`;
      }
      if (catKey.startsWith('Other_Auto_')) {
          return `Auto-Categorized: ${catKey.replace('Other_Auto_', '')}`;
      }
      return catKey;
  }

  // Filter skillsByCategory to only show categories that actually have skills
  const skillsToDisplay = Object.fromEntries(
    Object.entries(skillsByCategory).filter(([_, subCats]) =>
      Object.values(subCats).some(skills => skills.length > 0)
    )
  );


  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-100 to-indigo-200 p-8 flex items-center justify-center font-sans">
      <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-2xl border border-blue-200">
        <h1 className="text-3xl font-bold text-center text-blue-800 mb-6">
          What? <span className="text-xl font-normal">(Skills & Talents)</span>
        </h1>
        <p className="text-center text-gray-600 mb-8">
          Let's start by identifying your unique skills and talents. Select broad categories, then
          specify sub-categories and individual skills. You can also type a skill directly and we'll
          help categorize it!
        </p>

        {/* 1. Select Broad Categories Section */}
        <div className="mb-8 p-4 border border-blue-200 rounded-lg bg-blue-50">
          <h2 className="text-xl font-semibold text-gray-700 mb-4">1. Select Broad Categories</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {broadCategories.map((category) => (
              <label
                key={category}
                className="flex items-center p-3 border border-gray-300 rounded-lg cursor-pointer bg-white hover:bg-blue-50 transition-colors duration-200 shadow-sm"
              >
                <input
                  type="checkbox"
                  value={category}
                  checked={selectedBroadCategories.includes(category)}
                  onChange={handleBroadCategoryChange}
                  className="form-checkbox h-5 w-5 text-blue-600 rounded-md focus:ring-blue-500"
                />
                <span className="ml-3 text-lg text-gray-800 font-medium">{category}</span>
              </label>
            ))}
            <label
              className="flex items-center p-3 border border-gray-300 rounded-lg cursor-pointer bg-white hover:bg-blue-50 transition-colors duration-200 shadow-sm"
            >
              <input
                type="checkbox"
                value="Other"
                checked={selectedBroadCategories.includes('Other')}
                onChange={handleBroadCategoryChange}
                className="form-checkbox h-5 w-5 text-blue-600 rounded-md focus:ring-blue-500"
              />
              <span className="ml-3 text-lg text-gray-800 font-medium">Other (Specify below)</span>
            </label>
          </div>
        </div>

        {/* 2. Add Your Specific Skills Section */}
        {selectedBroadCategories.length > 0 && (
          <div className="mb-8 p-4 border border-green-200 rounded-lg bg-green-50">
            <h2 className="text-xl font-semibold text-gray-700 mb-4">2. Add Your Specific Skills</h2>

            {/* Select Broad Category Dropdown */}
            <div className="mb-4">
              <label htmlFor="selectBroadCategory" className="block text-gray-700 text-sm font-bold mb-2">
                Choose a broad category to add a skill:
              </label>
              <select
                id="selectBroadCategory"
                value={activeBroadCategory}
                onChange={handleActiveBroadCategoryChange}
                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:border-blue-500"
              >
                <option value="">-- Select Broad Category --</option>
                {selectedBroadCategories.filter(cat => !cat.startsWith('Other_Custom_') && !cat.startsWith('Other_Auto_Uncategorized')).map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
                {/* Also include custom/auto-categorized broad categories that have skills */}
                {Object.keys(skillsByCategory)
                    .filter(cat => (cat.startsWith('Other_Custom_') || cat.startsWith('Other_Auto_Uncategorized')) && !selectedBroadCategories.includes(cat))
                    .map(customCat => (
                        <option key={customCat} value={customCat}>
                            {formatCategoryForDisplay(customCat)}
                        </option>
                    ))}
              </select>
            </div>

            {/* Custom Broad Category Input (if 'Other' is selected) */}
            {activeBroadCategory === 'Other' && (
              <div className="mb-4">
                <label htmlFor="newCustomBroadCategory" className="block text-gray-700 text-sm font-bold mb-2">
                  Name your custom broad category:
                </label>
                <input
                  type="text"
                  id="newCustomBroadCategory"
                  value={newCustomBroadCategory}
                  onChange={(e) => setNewCustomBroadCategory(e.target.value)}
                  placeholder="e.g., Specialized Consulting"
                  className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:border-blue-500"
                />
              </div>
            )}

            {((activeBroadCategory && activeBroadCategory !== 'Other') || (activeBroadCategory === 'Other' && newCustomBroadCategory.trim() !== '')) && (
              <>
                {/* Select Sub-Category Dropdown */}
                {loadingSubCategories ? (
                  <div className="text-center text-gray-500 my-4">Loading sub-categories...</div>
                ) : (
                  suggestedSubCategories.length > 0 && (
                    <div className="mb-4">
                      <label htmlFor="selectSubCategory" className="block text-gray-700 text-sm font-bold mb-2">
                        Choose a sub-category for {formatCategoryForDisplay((activeBroadCategory === 'Other' && newCustomBroadCategory.trim() !== '') ? newCustomBroadCategory : activeBroadCategory)}:
                      </label>
                      <select
                        id="selectSubCategory"
                        value={activeSubCategory}
                        onChange={handleActiveSubCategoryChange}
                        className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:border-blue-500"
                      >
                        <option value="">-- Select Sub-Category --</option>
                        {suggestedSubCategories.map((subCat) => (
                          <option key={subCat} value={subCat}>
                            {subCat}
                          </option>
                        ))}
                      </select>
                    </div>
                  )
                )}

                {/* Enter Custom Skill OR Select Suggested Skill */}
                <div className="mb-4 text-center text-gray-500">
                  {((suggestedSubCategories.length > 0) && activeSubCategory) ? (
                    <>
                      {loadingSpecificSkills ? (
                        <div className="text-center text-gray-500 my-4">Loading specific skills...</div>
                      ) : (
                        suggestedSpecificSkills.length > 0 && (
                          <div className="mb-4">
                            <label htmlFor="suggestedSkills" className="block text-gray-700 text-sm font-bold mb-2">
                              Or select a suggested skill for {activeSubCategory}:
                            </label>
                            <select
                              id="suggestedSkills"
                              value={selectedSuggestedSkill}
                              onChange={(e) => setSelectedSuggestedSkill(e.target.value)}
                              className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:border-blue-500"
                            >
                              <option value="">-- Select a suggested skill --</option>
                              {suggestedSpecificSkills.map((skill) => (
                                <option key={skill} value={skill}>
                                  {skill}
                                </option>
                              ))}
                            </select>
                          </div>
                        )
                      )}
                      <div className="mb-4 text-center text-gray-500">
                        OR
                      </div>
                    </>
                  ) : (
                      <div className="mb-4 text-center text-gray-500">
                        Type your skill directly below for auto-categorization.
                      </div>
                  )}
                </div>

                <div className="flex items-end gap-2">
                  <div className="flex-grow">
                    <label htmlFor="newSkillInput" className="block text-gray-700 text-sm font-bold mb-2">
                      Enter a skill (custom or for auto-categorization):
                    </label>
                    <input
                      type="text"
                      id="newSkillInput"
                      value={newSkillInput}
                      onChange={(e) => setNewSkillInput(e.target.value)}
                      onKeyPress={(e) => { if (e.key === 'Enter') handleAddSkill(); }}
                      placeholder="e.g., Photography, Public Speaking, Data Analysis"
                      className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:border-blue-500"
                    />
                  </div>
                  <button
                    onClick={handleAddSkill}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline transition-colors duration-200 shadow-md"
                    disabled={
                      (newSkillInput.trim() === '' && selectedSuggestedSkill.trim() === '') ||
                      loadingAutoCategorization
                    }
                  >
                    {loadingAutoCategorization ? 'Categorizing...' : 'Add Skill'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* 3. Your Skills Summary Section */}
        {Object.keys(skillsToDisplay).length > 0 && (
          <div className="mt-8 p-4 border border-purple-200 rounded-lg bg-purple-50">
            <h2 className="text-xl font-semibold text-gray-700 mb-4">3. Your Skills Summary</h2>
            {Object.entries(skillsToDisplay).map(([broadCat, subCats]) => (
              Object.values(subCats).some(skills => skills.length > 0) && ( // Only render if sub-categories have skills
                <div key={broadCat} className="mb-4 bg-white p-4 rounded-lg border border-purple-100 shadow-sm">
                  <h3 className="text-lg font-bold text-purple-700 mb-2">{formatCategoryForDisplay(broadCat)}</h3>
                  {Object.entries(subCats).map(([subCat, skills]) => (
                    skills.length > 0 && (
                      <div key={`${broadCat}-${subCat}`} className="ml-4 mb-2">
                        <h4 className="text-md font-semibold text-gray-600 mb-1">{subCat}</h4>
                        <div className="flex flex-wrap gap-2">
                          {skills.map((skill) => (
                            <span
                              key={`${broadCat}-${subCat}-${skill}`}
                              className="flex items-center bg-purple-100 text-purple-800 text-sm font-medium px-3 py-1 rounded-full shadow-sm"
                            >
                              {skill}
                              <button
                                onClick={() => handleRemoveSkill(broadCat, subCat, skill)}
                                className="ml-2 text-purple-600 hover:text-purple-900 transition-colors duration-150"
                                aria-label={`Remove ${skill}`}
                              >
                                &times;
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  ))}
                </div>
              )
            ))}
          </div>
        )}

        {/* Navigation Button */}
        <div className="mt-8 text-center">
          {savingStatus && (
            <p className={`mb-4 text-sm font-medium ${savingStatus === 'Save failed!' ? 'text-red-600' : 'text-blue-600'}`}>
              {savingStatus}
            </p>
          )}
          <button
            className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg focus:outline-none focus:shadow-outline transition-colors duration-200 shadow-lg text-xl"
            disabled={Object.values(skillsByCategory).every(broadCatSkills => Object.values(broadCatSkills).every(subCatSkills => subCatSkills.length === 0)) || !isAuthReady || savingStatus === 'Saving...'}
            onClick={() => alert('Proceeding to next section (Who?)')} // Placeholder for navigation
          >
            Continue to Who?
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;

