 

        let isRunning = false, isPaused = false;
        let startTime = 0, elapsedBeforePause = 0, timerInterval = null, currentTotalMs = 0;
        let penaltyCount = 0, penaltyTime = 0, bonusCount = 0, bonusTime = 0, currentStatus = "REGULÄR";
        let currentModalMode = 'add_btn_penalty', popupWindow = null;
        
        let currentEvent = 'Standardlauf'; let eventList = ['Standardlauf']; let runs = []; let lockedEvents = []; let activeTab = 'single';
        let groupRunners = []; let groupInterval = null;
        let whitelabelUrl = '';

        let penaltyTypes = JSON.parse(localStorage.getItem('runnerPenaltyTypes')) || [];
        let bonusTypes = JSON.parse(localStorage.getItem('runnerBonusTypes')) || [];

        let availableLanguages = [];
        let defaultLanguage = 'de';
        let loadedLanguagesData = {}; 
        let currentLanguage = 'de';
        let translations = {}; 
        let watermarkText = ""; // Oben bei Euren Variablen definier
        let runnerChartInstance = null; // Speichert das aktuelle Chart.js Diagramm



        async function compressToBlobB64(str) {
            const stream = new Blob([str]).stream();
            const compressedStream = stream.pipeThrough(new CompressionStream("deflate"));
            const response = new Response(compressedStream);
            const blob = await response.blob();
            const buffer = await blob.arrayBuffer();
            return btoa(String.fromCharCode(...new Uint8Array(buffer)))
                .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        }

        async function decompressFromBlobB64(b64) {
            let base64 = b64.replace(/-/g, '+').replace(/_/g, '/');
            while (base64.length % 4) base64 += '=';
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            const stream = new Blob([bytes]).stream();
            const decompressedStream = stream.pipeThrough(new DecompressionStream("deflate"));
            const response = new Response(decompressedStream);
            const blob = await response.blob();
            return await blob.text();
        }

        function runsToUrlParam(runsArray) {
            const isLocked = lockedEvents.includes(currentEvent);
            const metadata = `${currentEvent}|${isLocked}`;
            
            const serializedRuns = runsArray.map(r => {
                const nameEscaped = r.name.replace(/[,;|]/g, ' '); 
                const pCount = r.penalties ? r.penalties.count : 0;
                const pTime = r.penalties ? r.penalties.time : 0;
                const bCount = r.bonuses ? r.bonuses.count : 0;
                const bTime = r.bonuses ? r.bonuses.time : 0;
                return `${r.id},${nameEscaped},${r.status},${r.timeMs},${pCount},${pTime},${bCount},${bTime}`;
            }).join(';');
            
            return `${metadata}|${serializedRuns}`;
        }

        function urlParamToRuns(decodedString) {
            if (!decodedString.trim()) return null;
            
            const parts = decodedString.split('|');
            let eventName = "Standardlauf";
            let isLocked = false;
            let runsString = "";
            
            if (parts.length >= 3) {
                eventName = parts[0];
                isLocked = parts[1] === "true";
                runsString = parts.slice(2).join('|'); 
            } else {
                runsString = decodedString; 
            }
            
            if (!runsString.trim()) {
                return { eventName, isLocked, runs: [] };
            }
            
            const rows = runsString.split(';');
            const importedRuns = rows.map(row => {
                const cols = row.split(',');
                if (cols.length < 8) throw new Error("Zeilenformat unvollständig.");
                
                const id = parseFloat(cols[0]);
                const name = cols[1];
                const status = cols[2];
                const timeMs = parseInt(cols[3], 10);
                const pCount = parseInt(cols[4], 10);
                const pTime = parseInt(cols[5], 10);
                const bCount = parseInt(cols[6], 10);
                const bTime = parseInt(cols[7], 10);

                const timeStr = (status === "DNF" || status === "DNS") ? status : formatTime(timeMs);

                return {
                    id: id,
                    name: name,
                    status: status,
                    timeMs: timeMs,
                    timeString: timeStr,
                    penalties: { count: pCount, time: pTime },
                    bonuses: { count: bCount, time: bTime }
                };
            });

            return { eventName, isLocked, runs: importedRuns };
        }

        window.onload = async function() {
            eventList = JSON.parse(localStorage.getItem('runnerEventList')) || ['Standardlauf'];
            currentEvent = localStorage.getItem('runnerCurrentEventName') || 'Standardlauf';
            lockedEvents = JSON.parse(localStorage.getItem('runnerLockedEvents')) || [];
            
            await initLanguages();
            buildEventSelectMenu(); loadRunsForCurrentEvent(); renderCustomButtons('penalty'); renderCustomButtons('bonus'); initTheme(); resetForm(); loadVersionInfo(); loadWhitelabelInfo();
            loadWatermark();
            checkUrlImport();
            
            updateRunnerDatalist();
        };

        window.onunload = function() { if (popupWindow) popupWindow.close(); };

        async function initLanguages() {
            try {
                const infoRes = await fetch('lang.info');
                if (!infoRes.ok) throw new Error("lang.info konnte nicht geladen werden.");
                const langInfo = await infoRes.json();
                
                availableLanguages = langInfo.available || ['de', 'en'];
                defaultLanguage = langInfo.default || 'de';
            } catch (e) {
                console.warn("Nutze Fallback-Sprachen, da lang.info fehlt oder blockiert wurde:", e);
                availableLanguages = ['de', 'en'];
                defaultLanguage = 'de';
            }

            currentLanguage = localStorage.getItem('runnerLanguage') || defaultLanguage;
            if (!availableLanguages.includes(currentLanguage)) {
                currentLanguage = defaultLanguage;
            }

            for (const lang of availableLanguages) {
                try {
                    const response = await fetch(`lang/${lang}.lang`);
                    if (!response.ok) throw new Error();
                    loadedLanguagesData[lang] = await response.json();
                } catch (e) {
                    console.error(`Sprachdatei für "${lang}" konnte nicht geladen werden.`, e);
                }
            }

            if (!loadedLanguagesData[currentLanguage]) {
                currentLanguage = Object.keys(loadedLanguagesData)[0] || defaultLanguage;
            }

            buildLanguageDropdown();
            applyLanguage(currentLanguage);
        }

        function buildLanguageDropdown() {
            const select = document.getElementById('langSelect');
            if (!select) return;
            select.innerHTML = '';
            for (const lang in loadedLanguagesData) {
                const opt = document.createElement('option');
                opt.value = lang;
                const flag = loadedLanguagesData[lang]['_meta_flag'] || '🌐';
                const name = loadedLanguagesData[lang]['_meta_name'] || lang.toUpperCase();
                opt.innerText = `${flag} ${name}`;
                if (lang === currentLanguage) opt.selected = true;
                select.appendChild(opt);
            }
        }
        
        async function loadWatermark() {
    try {
        const response = await fetch('whitelabel.info');
        const text = await response.text();
        const lines = text.split('\n');
        lines.forEach(line => {
            if (line.startsWith('watermark=')) {
                watermarkText = line.replace('watermark=', '').trim();
            }
        });
        console.log("Wasserzeichen geladen:", watermarkText);
    } catch (e) {
        console.warn("whitelabel.info konnte nicht geladen werden.");
    }
}

        function loadWhitelabelInfo() {
            fetch('whitelabel.info').then(response => { if (!response.ok) throw new Error(); return response.text(); }).then(text => {
                const lines = text.split('\n'); 
                let title = "⏱️ Zeitmessung"; 
                let url = "";
                let coffeeUrl = "";
                let githubUrl = "";
                
                lines.forEach(line => { 
                    const tl = line.trim(); 
                    if (tl.startsWith('Title=')) {
                        title = tl.replace('Title=', '').trim(); 
                    } else if (tl.startsWith('URL=')) {
                        url = tl.replace('URL=', '').trim(); 
                    } else if (tl.startsWith('coffee=')) {
                        coffeeUrl = tl.replace('coffee=', '').trim();
                    } else if (tl.startsWith('github=')) {
                        githubUrl = tl.replace('github=', '').trim();
                    }
                });
                
                const el = document.getElementById('whitelabelTitle'); 
                el.innerText = title; 
                whitelabelUrl = url;
                if (url) { 
                    el.setAttribute('href', url); 
                    el.setAttribute('target', '_blank'); 
                } else {
                    el.removeAttribute('href'); 
                }

                const coffeeEl = document.getElementById('coffeeLink');
                if (coffeeEl) {
                    if (coffeeUrl) {
                        coffeeEl.setAttribute('href', coffeeUrl);
                        coffeeEl.style.display = 'flex'; 
                    } else {
                        coffeeEl.style.display = 'none'; 
                    }
                }

                const githubEl = document.getElementById('githubLink');
                if (githubEl) {
                    if (githubUrl) {
                        githubEl.setAttribute('href', githubUrl);
                        githubEl.style.display = 'flex'; 
                    } else {
                        githubEl.style.display = 'none'; 
                    }
                }
            }).catch(() => { 
                const el = document.getElementById('whitelabelTitle'); 
                el.innerText = "⏱️ Zeitmessung"; 
                el.removeAttribute('href'); 
                if (document.getElementById('coffeeLink')) document.getElementById('coffeeLink').style.display = 'none';
                if (document.getElementById('githubLink')) document.getElementById('githubLink').style.display = 'none';
            });
        }

        function loadVersionInfo() { fetch('ver.info').then(res => res.text()).then(v => { document.getElementById('appFooter').innerText = `Version: ${v.trim()}`; }).catch(() => { document.getElementById('appFooter').innerText = 'Version: Lokal / Unbekannt'; }); }
        
        function openChangelogModal() {
    const container = document.getElementById('changelogContent');
    container.innerHTML = translations['lblChangelogLoading'] || "Lade Changelog...";
    document.getElementById('changelogModal').style.display = 'flex';
    
    fetch('Changelog.info')
        .then(res => { if (!res.ok) throw new Error(); return res.text(); })
        .then(text => { 
            container.innerHTML = ''; // Leeren
            
            // Invertierung: Letzte Zeile zuerst
            const lines = text.split('\n').filter(l => l.trim() !== "").reverse();
            
            lines.forEach(line => {
                const parts = line.split('=');
                const version = parts[0] ? parts[0].trim() : "?";
                const description = parts[1] ? parts[1].trim() : "";
                
                const item = document.createElement('div');
                item.className = 'changelog-item';
                item.innerHTML = `
                    <span class="changelog-version">${version}</span>
                    <span class="changelog-desc">${description}</span>
                `;
                container.appendChild(item);
            });
        })
        .catch(() => { 
            container.innerHTML = translations['lblChangelogError'] || "Fehler beim Laden des Changelogs."; 
        });
}
        
        function closeChangelogModal() { document.getElementById('changelogModal').style.display = 'none'; }
        function closeChangelogModalOnOutsideClick(e) { if(e.target.id === 'changelogModal') closeChangelogModal(); }

        function setLanguage(lang) {
            currentLanguage = lang;
            localStorage.setItem('runnerLanguage', lang);
            applyLanguage(lang);
        }

        function applyLanguage(lang) {
    // 1. Hole die Daten des Standards und der gewählten Sprache
    const defaultData = loadedLanguagesData[defaultLanguage] || {};
    const currentData = loadedLanguagesData[lang] || {};
    
    // 2. Merge: Alles aus dem Default nehmen und mit den Werten der aktuellen Sprache überschreiben/ergänzen
    translations = { ...defaultData, ...currentData };
    
    // 3. UI-Elemente übersetzen
    for (const key in translations) {
        if (key.startsWith('_meta')) continue; 
        const el = document.getElementById(key);
        if (el) {
            el.innerText = translations[key];
        }
    }
            
            const runnerInput = document.getElementById('runnerName');
    if (runnerInput && translations['runnerNamePlaceholder']) {
        runnerInput.placeholder = translations['runnerNamePlaceholder'];
    }
            
            const groupInput = document.getElementById('groupRunnerInput');
    if (groupInput && translations['groupRunnerInputPlaceholder']) {
        groupInput.placeholder = translations['groupRunnerInputPlaceholder'];
    }
    
    const btnSingle = document.getElementById('btnSearchSingle');
if (btnSingle) btnSingle.title = translations['lblSearchTooltip'] || "Läufer suchen";

const btnGroup = document.getElementById('btnSearchGroup');
if (btnGroup) btnGroup.title = translations['lblSearchTooltip'] || "Läufer suchen";


            buildEventSelectMenu();
    syncPopupRunnerName();
    syncPopupNotice();
    sortAndDisplayRuns();
        }

        function getCleanDisplayName(name) { return name.replace(/^\[.*?\]/, '').trim(); }
        function isEmoji(str) { return /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g.test(str); }

        function countryCodeToEmoji(code) {
            const c = code.toUpperCase();
            if (c.length === 2) {
                return String.fromCodePoint(...[...c].map(char => 127397 + char.charCodeAt(0)));
            }
            return '🏃';
        }

        function processImportedPayload(targetEventName, targetIsLocked, importedRuns) {
            let selectedEvent = currentEvent;
            
            if (!eventList.includes(targetEventName)) {
                eventList.push(targetEventName);
                localStorage.setItem('runnerEventList', JSON.stringify(eventList));
                
                if (targetIsLocked && !lockedEvents.includes(targetEventName)) {
                    lockedEvents.push(targetEventName);
                    localStorage.setItem('runnerLockedEvents', JSON.stringify(lockedEvents));
                } else if (!targetIsLocked && lockedEvents.includes(targetEventName)) {
                    lockedEvents = lockedEvents.filter(e => e !== targetEventName);
                    localStorage.setItem('runnerLockedEvents', JSON.stringify(lockedEvents));
                }
                
                currentEvent = targetEventName;
                localStorage.setItem('runnerCurrentEventName', currentEvent);
                runs = importedRuns;
                saveRunsForCurrentEvent();
                
                buildEventSelectMenu();
                sortAndDisplayRuns();
                resetForm();
                
                alert(translations['lblImportSuccess'] || `Erfolgreich importiert: "${targetEventName}"!`);
            } else {
                if (confirm(translations['lblImportOverwriteConfirm'] || `Das Event "${targetEventName}" existiert bereits. Überschreiben?`)) {
                    
                    if (targetIsLocked && !lockedEvents.includes(targetEventName)) {
                        lockedEvents.push(targetEventName);
                    } else if (!targetIsLocked && lockedEvents.includes(targetEventName)) {
                        lockedEvents = lockedEvents.filter(e => e !== targetEventName);
                    }
                    localStorage.setItem('runnerLockedEvents', JSON.stringify(lockedEvents));
                    
                    currentEvent = targetEventName;
                    localStorage.setItem('runnerCurrentEventName', currentEvent);
                    runs = importedRuns;
                    saveRunsForCurrentEvent();
                    
                    buildEventSelectMenu();
                    sortAndDisplayRuns();
                    resetForm();
                }
            }
        }

        function getFaviconUrl(domain) {
            return `https://www.google.com/s2/favicons?domain=${domain}`;
        }

        function getRunnerIconHTML(name, isExportMode = false) {
            const match = name.match(/^\[(.*?)\]/);
            if (match) {
                const content = match[1].trim();
                const domainRegex = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/i;
                if (domainRegex.test(content)) {
                    if (isExportMode) return `<span class="runner-icon">🌐</span>`;
                    let cleanDomain = content.replace(/^(https?:\/\/)?(www\.)?/, '');
                    return `<span class="runner-icon"><img src="${getFaviconUrl(cleanDomain)}" alt="favicon" onerror="this.onerror=null; this.parentElement.innerHTML='🌐';"></span>`;
                }
                if (content.length === 2 || content.length === 3) {
                    if (!isEmoji(content)) {
                        return `<span class="runner-icon">${countryCodeToEmoji(content)}</span>`;
                    }
                }
                if (isEmoji(content)) return `<span class="runner-icon">${content}</span>`;
            }
            return `<span class="runner-icon">🏃</span>`;
        }

        function switchTab(mode) {
            if (isRunning || groupRunners.some(r => r.state === 'running' || r.state === 'paused')) { alert(translations['lblTabSwitchBlock'] || "Wechsel blockiert während aktiver Messung!"); return; }
            activeTab = mode;
            document.getElementById('tabSingleBtn').classList.toggle('active', mode === 'single');
            document.getElementById('tabGroupBtn').classList.toggle('active', mode === 'group');
            document.getElementById('tabSingleContent').classList.toggle('active', mode === 'single');
            document.getElementById('tabGroupContent').classList.toggle('active', mode === 'group');
            if(popupWindow && !popupWindow.closed) { syncPopupRunnerName(); syncPopupNotice(); }
        }

                function addRunnerToGroup() {
            const input = document.getElementById('groupRunnerInput'); 
            const name = input.value.trim(); 
            if(!name) { 
                alert(translations['lblEnterRunnerName'] || "Bitte einen Namen eingeben."); 
                return; 
            }
            
            // NEU: Läufer im globalen Register speichern
            registerRunner(name);

            groupRunners.push({ 
                id: Date.now() + Math.random(), 
                name: name, 
                state: 'idle', 
                timeMs: 0, 
                startTime: 0, 
                elapsed: 0, 
                status: 'REGULÄR', 
                penalties: { count: 0, time: 0 }, 
                bonuses: { count: 0, time: 0 } 
            });
            input.value = ''; 
            renderGroupRunners(); 
            document.getElementById('groupMassActionRow').style.display = 'block';
        }


        function startAllGroupRunners() {
            if(groupRunners.length === 0) return; const now = Date.now();
            groupRunners.forEach(r => { if(r.state === 'idle') { r.state = 'running'; r.startTime = now; } });
            document.getElementById('groupSetupForm').style.display = 'none'; document.getElementById('groupMassActionRow').style.display = 'none';
            startGroupTicker(); renderGroupRunners();
        }

        async function exportToLink() {
            if (runs.length === 0) {
                alert(translations['lblNoRunsToExport'] || "Keine Läufe zum Exportieren.");
                return;
            }
            try {
                const rawCsv = runsToUrlParam(runs);
                const compressedData = await compressToBlobB64(rawCsv);
                const finalParam = "v2~" + compressedData;
                
                const baseUrl = whitelabelUrl || (window.location.origin + window.location.pathname);
                const shareUrl = `${baseUrl}?import=${encodeURIComponent(finalParam)}`;
                
                navigator.clipboard.writeText(shareUrl).then(() => {
                    alert(translations['lblLinkCopied'] || "Link kopiert!");
                }).catch(() => {
                    prompt(translations['lblCopyThisLink'] || "Diesen Link kopieren:", shareUrl);
                });
            } catch (e) {
                console.error(e);
                alert(translations['lblLinkError'] || "Fehler beim Erstellen des Links.");
            }
        }

        async function checkUrlImport() {
            const params = new URLSearchParams(window.location.search);
            let importData = params.get('import');
            if (importData) {
                try {
                    let importedPayload = null;
                    let decodedCsvString = "";

                    if (importData.startsWith('v2~')) {
                        const base64Data = importData.substring(3);
                        decodedCsvString = await decompressFromBlobB64(base64Data);
                        importedPayload = urlParamToRuns(decodedCsvString);
                    } else if (importData.startsWith('W3siaWQi') || (importData.includes('%') === false && importData.includes(',') === false)) {
                        const repairedBase64 = importData.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
                        const binString = atob(repairedBase64);
                        const bytes = new Uint8Array(binString.length);
                        for (let i = 0; i < binString.length; i++) {
                            bytes[i] = binString.charCodeAt(i);
                        }
                        const finalStr = new TextDecoder().decode(bytes);
                        const importedRuns = JSON.parse(finalStr);
                        importedPayload = { eventName: "Standardlauf", isLocked: false, runs: importedRuns };
                    } else {
                        decodedCsvString = decodeURIComponent(importData);
                        importedPayload = urlParamToRuns(decodedCsvString);
                    }

                    if (importedPayload && Array.isArray(importedPayload.runs)) {
                        setTimeout(() => {
                            processImportedPayload(importedPayload.eventName, importedPayload.isLocked, importedPayload.runs);
                            window.history.replaceState({}, document.title, window.location.pathname);
                        }, 500);
                    } else {
                        throw new Error("Daten-Struktur unvollständig.");
                    }
                } catch (e) {
                    console.error("Link-Import-Fehler:", e);
                    alert((translations['lblImportError'] || "Fehler beim Import: ") + e.message);
                }
            }
        }

        function importJSONData(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = e => {
                try {
                    const data = JSON.parse(e.target.result);
                    let targetEventName = currentEvent;
                    let targetIsLocked = lockedEvents.includes(currentEvent);
                    let targetRuns = [];

                    if (data && typeof data === 'object' && !Array.isArray(data)) {
                        targetEventName = data.eventName || currentEvent;
                        targetIsLocked = data.isLocked === true;
                        targetRuns = data.runs || [];
                    } else if (Array.isArray(data)) {
                        targetRuns = data;
                    } else {
                        throw new Error("Ungültiges Dateiformat.");
                    }

                    if (Array.isArray(targetRuns)) {
                        processImportedPayload(targetEventName, targetIsLocked, targetRuns);
                    } else {
                        throw new Error("Die JSON-Datei enthält kein gültiges Array.");
                    }
                } catch (err) {
                    console.error("JSON-Import-Fehler:", err);
                    alert((translations['lblImportError'] || "Fehler beim Import: ") + err.message);
                }
                document.getElementById('jsonImportInput').value = '';
            };
            reader.readAsText(file);
        }

        function startGroupTicker() {
            if(groupInterval) clearInterval(groupInterval);
            groupInterval = setInterval(() => {
                const now = Date.now(); groupRunners.forEach(r => { if(r.state === 'running') { r.timeMs = now - r.startTime + r.elapsed; } });
                updateGroupLiveDisplays();
            }, 10);
        }

        function updateGroupLiveDisplays() {
            groupRunners.forEach(r => { const el = document.getElementById(`gDisplay_${r.id}`); if(el) el.innerText = r.status === 'DNF' || r.status === 'DNS' ? r.status : formatTime(r.timeMs); });
            if (popupWindow && !popupWindow.closed) syncPopupLeaderboard();
        }

        function toggleGroupRunnerTimer(id) {
            const r = groupRunners.find(runner => runner.id === id); if(!r || r.state === 'stopped') return;
            if(r.state === 'running') { r.state = 'paused'; r.elapsed = r.timeMs; } else { r.state = 'running'; r.startTime = Date.now(); }
            renderGroupRunners();
        }

        function stopGroupRunnerTimer(id) {
            const r = groupRunners.find(runner => runner.id === id); if(!r) return;
            r.state = 'stopped'; renderGroupRunners();
            if(groupRunners.every(runner => runner.state === 'stopped')) clearInterval(groupInterval);
        }

        function adjustGroupTime(id, mode, secs) {
            const r = groupRunners.find(runner => runner.id === id); if(!r || r.status === 'DNF' || r.status === 'DNS') return;
            if(mode === 'penalty') { r.penalties.count++; r.penalties.time += secs; r.timeMs += (secs * 1000); r.elapsed += (secs * 1000); if(r.state === 'running') r.startTime -= (secs * 1000); } 
            else { r.bonuses.count++; r.bonuses.time += secs; r.timeMs -= (secs * 1000); r.elapsed -= (secs * 1000); if(r.state === 'running') r.startTime += (secs * 1000); }
            if(r.timeMs < 0) { r.timeMs = 0; r.elapsed = 0; if(r.state === 'running') r.startTime = Date.now(); }
            renderGroupRunners();
        }

        function setGroupStatus(id, stat) {
            const r = groupRunners.find(runner => runner.id === id); if(!r) return;
            r.status = stat;
            if(stat === 'DNS' || stat === 'DNF' || stat === 'DNQ') { r.state = 'stopped'; if (stat === 'DNS' || stat === 'DNF') { r.timeMs = 0; r.elapsed = 0; r.penalties = {count:0,time:0}; r.bonuses = {count:0,time:0}; } }
            renderGroupRunners();
        }

                function saveGroupRunner(id) {
            const r = groupRunners.find(runner => runner.id === id); 
            if(!r) return;
            
            // NEU: Läufer im globalen Register speichern
            registerRunner(r.name);

            runs.push({ 
                id: Date.now() + Math.random(), 
                name: r.name, 
                timeMs: r.timeMs, 
                timeString: (r.status === "DNF" || r.status === "DNS") ? r.status : formatTime(r.timeMs), 
                status: r.status, 
                penalties: r.penalties, 
                bonuses: r.bonuses 
            });
            
            saveRunsForCurrentEvent(); 
            sortAndDisplayRuns(); 
            groupRunners = groupRunners.filter(runner => runner.id !== id); 
            renderGroupRunners();
            
            if(groupRunners.length === 0) { 
                document.getElementById('groupSetupForm').style.display = 'block'; 
                resetForm(); 
            }
        }


        function renderGroupRunners() {
            const container = document.getElementById('groupRunnersContainer'); container.innerHTML = '';
            groupRunners.forEach(r => {
                const div = document.createElement('div'); div.className = 'group-runner-row';
                let controls = '';
                if(r.state === 'idle') controls = `<div class="group-mini-btn-row"><button class="btn group-mini-btn" style="background-color: var(--status-color);" onclick="setGroupStatus(${r.id}, 'DNS')">DNS</button><button class="btn group-mini-btn" style="background-color: var(--danger);" onclick="setGroupStatus(${r.id}, 'DNF')">DNF</button><button class="btn group-mini-btn" style="background-color: #7f8c8d;" onclick="setGroupStatus(${r.id}, 'DNQ')">DNQ</button></div>`;
                else if(r.state === 'running' || r.state === 'paused') controls = `<div class="group-mini-btn-row"><button class="btn group-mini-btn ${r.state === 'running' ? 'btn-pause' : 'btn-start'}" onclick="toggleGroupRunnerTimer(${r.id})">${r.state === 'running' ? (translations['lblPauseBtn'] || 'Pause') : (translations['lblContinueBtn'] || 'Weiter')}</button><button class="btn btn-stop group-mini-btn" onclick="stopGroupRunnerTimer(${r.id})">${translations['lblStopBtn'] || 'Stop'}</button></div>`;
                else if(r.state === 'stopped') {
                    let mod = '';
                    if(r.status === 'REGULÄR') mod = `<div style="margin: 8px 0; display:flex; flex-wrap:wrap; gap:4px;">${penaltyTypes.map(p => `<button class="btn" style="background:var(--penalty); font-size:0.75rem; padding:4px 8px;" onclick="adjustGroupTime(${r.id}, 'penalty', ${p.seconds})">${p.name}</button>`).join('')}${bonusTypes.map(b => `<button class="btn" style="background:var(--bonus); font-size:0.75rem; padding:4px 8px;" onclick="adjustGroupTime(${r.id}, 'bonus', ${b.seconds})">${b.name}</button>`).join('')}</div><div style="font-size:0.85rem; font-weight:600; margin-bottom:6px; color:var(--penalty)">${translations['lblEditPenaltyCount'] || 'Strafen'}: +${r.penalties.time}s | ${translations['lblEditBonusCount'] || 'Boni'}: -${r.bonuses.time}s</div>`;
                    controls = `${mod}<div class="group-mini-btn-row"><button class="btn btn-start group-mini-btn" onclick="saveGroupRunner(${r.id})">💾 ${translations['lblEditModalSave'] || 'Speichern'}</button>${r.status === 'REGULÄR' ? `<button class="btn group-mini-btn" style="background-color: var(--danger);" onclick="setGroupStatus(${r.id}, 'DNF')">DNF</button><button class="btn group-mini-btn" style="background-color: var(--status-color);" onclick="setGroupStatus(${r.id}, 'DNQ')">DNQ</button>` : ''}</div>`;
                }
                div.innerHTML = `<div class="group-runner-header"><span class="group-runner-name-label">${escapeHTML(getCleanDisplayName(r.name))} ${r.status !== 'REGULÄR' ? `[${r.status}]` : ''}</span><span class="group-time-display" id="gDisplay_${r.id}">${r.status === 'DNF' || r.status === 'DNS' ? r.status : formatTime(r.timeMs)}</span></div>${controls}`;
                container.appendChild(div);
            });
            if (popupWindow && !popupWindow.closed) syncPopupLeaderboard();
        }

        function buildEventSelectMenu() {
            const select = document.getElementById('eventSelect'); select.innerHTML = '';
            eventList.forEach(ev => { const opt = document.createElement('option'); opt.value = ev; opt.innerText = (lockedEvents.includes(ev) ? '🔒 ' : '') + (ev === 'Standardlauf' ? (translations['lblStandardRun'] || 'Standardlauf') : '🏆 ' + ev); if (ev === currentEvent) opt.selected = true; select.appendChild(opt); });
            updateLockBtnStyle();
        }
        function openEventCreationModal() { document.getElementById('eventModal').style.display = 'flex'; document.getElementById('newEventName').focus(); }
        function closeEventModal() { document.getElementById('eventModal').style.display = 'none'; document.getElementById('newEventName').value = ''; }
        function createNewEvent() { const name = document.getElementById('newEventName').value.trim(); if (!name) { alert(translations['lblErrorNoEventName'] || "Bitte Eventnamen eingeben."); return; } if (eventList.includes(name)) { alert(translations['lblErrorEventExists'] || "Event existiert bereits."); return; } eventList.push(name); localStorage.setItem('runnerEventList', JSON.stringify(eventList)); currentEvent = name; localStorage.setItem('runnerCurrentEventName', currentEvent); buildEventSelectMenu(); loadRunsForCurrentEvent(); closeEventModal(); }
        function handleEventSelectChange() { currentEvent = document.getElementById('eventSelect').value; localStorage.setItem('runnerCurrentEventName', currentEvent); loadRunsForCurrentEvent(); resetForm(); updateLockBtnStyle(); }
         
        function deleteCurrentEvent() { 
            if (currentEvent === 'Standardlauf') { alert(translations['lblErrorCannotDeleteStandard'] || "Standardlauf kann nicht gelöscht werden."); return; } 
            if (!confirm(translations['lblConfirmDeleteEvent'] || `Event "${currentEvent}" wirklich löschen?`)) return; 
            
            // In den Papierkorb verschieben
            const trash = JSON.parse(localStorage.getItem('runnerTrash')) || { events: [], runs: [] };
            const isLocked = lockedEvents.includes(currentEvent);
            trash.events.push({ trashId: Date.now() + Math.random(), deletedAt: Date.now(), eventName: currentEvent, runsData: runs, isLocked: isLocked });
            localStorage.setItem('runnerTrash', JSON.stringify(trash));

            // Lokal löschen
            localStorage.removeItem(`runnerLeaderboard_${currentEvent}`); 
            eventList = eventList.filter(e => e !== currentEvent); 
            lockedEvents = lockedEvents.filter(e => e !== currentEvent); 
            localStorage.setItem('runnerEventList', JSON.stringify(eventList)); 
            localStorage.setItem('runnerLockedEvents', JSON.stringify(lockedEvents)); 
            currentEvent = 'Standardlauf'; 
            localStorage.setItem('runnerCurrentEventName', currentEvent); 
            buildEventSelectMenu(); 
            loadRunsForCurrentEvent(); 
            resetForm(); 
        }
        
        function toggleLockCurrentEvent() { if (isRunning || groupRunners.length > 0) { alert(translations['lblTabSwitchBlock'] || "Blockiert während Messung."); return; } if(lockedEvents.includes(currentEvent)) lockedEvents = lockedEvents.filter(e => e !== currentEvent); else lockedEvents.push(currentEvent); localStorage.setItem('runnerLockedEvents', JSON.stringify(lockedEvents)); buildEventSelectMenu(); resetForm(); }
        
        
               function updateLockBtnStyle() {
            const span = document.getElementById('lblEventActionLock');
            const isLocked = lockedEvents.includes(currentEvent);
            
            if (span) {
                span.innerText = isLocked ? (translations['lblEventActionUnlock'] || "🔓 Entsperren") : (translations['lblEventActionLock'] || "🔒 Sperren");
            }

            // 1. Die Karte mit der Einzel-Zeitmessung automatisch finden und steuern
            const runnerInput = document.getElementById('runnerName');
            if (runnerInput) {
                const singleTimingCard = runnerInput.closest('.card');
                if (singleTimingCard) singleTimingCard.style.display = isLocked ? 'none' : '';
            }

            // 2. Die Karte mit der Gruppen-Zeitmessung automatisch finden und steuern
            const groupInput = document.getElementById('groupRunnerInput');
            if (groupInput) {
                const groupTimingCard = groupInput.closest('.card');
                if (groupTimingCard) groupTimingCard.style.display = isLocked ? 'none' : '';
            }

            // 3. Die Tab-Navigation (falls vorhanden) ebenfalls steuern
            const tabs = document.querySelector('.tab-container') || document.querySelector('.tabs');
            if (tabs) {
                const tabCard = tabs.closest('.card') || tabs;
                tabCard.style.display = isLocked ? 'none' : '';
            }
        }


        
        function loadRunsForCurrentEvent() { runs = JSON.parse(localStorage.getItem(`runnerLeaderboard_${currentEvent}`)) || []; sortAndDisplayRuns(); }
        function saveRunsForCurrentEvent() { localStorage.setItem(`runnerLeaderboard_${currentEvent}`, JSON.stringify(runs)); }

        function initTheme() { const saved = localStorage.getItem('theme') || 'light'; document.documentElement.setAttribute('data-theme', saved); document.getElementById('themeIcon').innerText = saved === 'dark' ? "☀️" : "🌙"; document.getElementById('themeText').innerText = saved === 'dark' ? "Light Mode" : "Dark Mode"; syncPopupTheme(); }
        function toggleTheme() { const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', newTheme); localStorage.setItem('theme', newTheme); initTheme(); }
 
        function openModal(mode) {
        if (lockedEvents.includes(currentEvent)) return; 
        currentModalMode = mode; 
        document.getElementById('modalTitle').innerText = mode === 'add_btn_penalty' ? (translations['lblNewBtnName'] || "Name:") : (translations['lblNewBtnName'] || "Name:");
        document.getElementById('newBtnName').placeholder = translations['lblNewBtnPlaceholder'] || "Name...";
        document.getElementById('customModal').style.display = 'flex';
        document.getElementById('newBtnName').focus();
        }
        
        function closeModal() { document.getElementById('customModal').style.display = 'none'; document.getElementById('newBtnName').value = ''; document.getElementById('newBtnSeconds').value = ''; }
        function createNewButton() { const name = document.getElementById('newBtnName').value.trim(), secs = parseInt(document.getElementById('newBtnSeconds').value, 10); if (!name) { alert(translations['lblEnterRunnerName'] || "Bitte Namen eingeben."); return; } if (isNaN(secs) || secs <= 0) { alert("Ungültige Zeit."); return; } if (currentModalMode === 'add_btn_penalty') { penaltyTypes.push({id: Date.now(), name: `${name} (+${secs}s)`, seconds: secs}); localStorage.setItem('runnerPenaltyTypes', JSON.stringify(penaltyTypes)); renderCustomButtons('penalty'); } else { bonusTypes.push({id: Date.now(), name: `${name} (-${secs}s)`, seconds: secs}); localStorage.setItem('runnerBonusTypes', JSON.stringify(bonusTypes)); renderCustomButtons('bonus'); } closeModal(); renderGroupRunners(); }
        function deleteCustomType(id, mode, e) { e.stopPropagation(); if (mode === 'penalty') { penaltyTypes = penaltyTypes.filter(p => p.id !== id); localStorage.setItem('runnerPenaltyTypes', JSON.stringify(penaltyTypes)); renderCustomButtons('penalty'); } else { bonusTypes = bonusTypes.filter(b => b.id !== id); localStorage.setItem('runnerBonusTypes', JSON.stringify(bonusTypes)); renderCustomButtons('bonus'); } renderGroupRunners(); }
        function renderCustomButtons(mode) { const container = document.getElementById(mode === 'penalty' ? 'dynamicPenaltyGroup' : 'dynamicBonusGroup'); container.innerHTML = ''; const target = mode === 'penalty' ? penaltyTypes : bonusTypes; const isSaveDisabled = document.getElementById('saveBtn').disabled || lockedEvents.includes(currentEvent); target.forEach(item => { const wrapper = document.createElement('div'); wrapper.className = `custom-btn-container type-${mode}`; wrapper.innerHTML = `<button class="btn-custom-action" ${isSaveDisabled?'disabled':''} onclick="handleTimeAdjustment('${mode}', ${item.seconds})">${item.name}</button><button class="delete-custom-type-btn" ${lockedEvents.includes(currentEvent)?'disabled':''} onclick="deleteCustomType(${item.id}, '${mode}', event)">&times;</button>`; container.appendChild(wrapper); }); }
        function setActionButtonsDisabled(d) { const isLocked = lockedEvents.includes(currentEvent); document.querySelectorAll('#tabSingleContent .btn-custom-action').forEach(b => b.disabled = d || isLocked); document.getElementById('statusBtnDNQ').disabled = d || isLocked; }
        function formatTime(ms) { if (ms < 0) ms = 0; let h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), hh = Math.floor((ms % 1000) / 10); return (h<10?"0":"")+h+":"+(m<10?"0":"")+m+":"+(s<10?"0":"")+s+"."+(hh<10?"0":"")+hh; }

        function toggleTimer() {
            if (lockedEvents.includes(currentEvent)) return;
            if (!document.getElementById('runnerName').value.trim()) { alert(translations['lblEnterRunnerName'] || "Bitte Läufernamen eingeben."); return; }
            const startBtn = document.getElementById('startBtn');
            if (currentStatus !== "REGULÄR") { currentStatus = "REGULÄR"; document.getElementById('display').innerText = "00:00:00.00"; updateAdjustmentNoticeDisplay(); }
            if (!isRunning) {
                isRunning = true; startTime = Date.now() - elapsedBeforePause;
                timerInterval = setInterval(() => { currentTotalMs = Date.now() - startTime; document.getElementById('display').innerText = formatTime(currentTotalMs); syncPopupTime(formatTime(currentTotalMs)); }, 10);
                startBtn.innerText = translations['lblPauseBtn'] || "Pause"; startBtn.className = "btn btn-pause"; document.getElementById('stopBtn').disabled = false; document.getElementById('saveBtn').disabled = true; document.getElementById('runnerName').disabled = true; setActionButtonsDisabled(true);
            } else { isRunning = false; isPaused = true; clearInterval(timerInterval); elapsedBeforePause = currentTotalMs; startBtn.innerText = translations['lblContinueBtn'] || "Weiter"; startBtn.className = "btn btn-start"; }
        }
        function stopTimer() { isRunning = false; isPaused = false; clearInterval(timerInterval); document.getElementById('startBtn').disabled = true; document.getElementById('startBtn').innerText = translations['lblStartBtn'] || "Start"; document.getElementById('stopBtn').disabled = true; document.getElementById('saveBtn').disabled = lockedEvents.includes(currentEvent); setActionButtonsDisabled(false); }
        function handleTimeAdjustment(mode, secs) { if (currentStatus !== "REGULÄR") return; if (mode === 'penalty') { penaltyCount++; penaltyTime += secs; currentTotalMs += (secs*1000); elapsedBeforePause += (secs*1000); if(isRunning) startTime -= (secs*1000); } else { bonusCount++; bonusTime += secs; currentTotalMs -= (secs*1000); elapsedBeforePause -= (secs*1000); if(isRunning) startTime += (secs*1000); } if (currentTotalMs < 0) { currentTotalMs = 0; elapsedBeforePause = 0; if(isRunning) startTime = Date.now(); } document.getElementById('display').innerText = formatTime(currentTotalMs); syncPopupTime(formatTime(currentTotalMs)); updateAdjustmentNoticeDisplay(); }
        function handleStatusSet(s) { if (lockedEvents.includes(currentEvent)) return; if (!document.getElementById('runnerName').value.trim()) { alert(translations['lblEnterRunnerName'] || "Name fehlt."); return; } currentStatus = s; if (s !== "REGULÄR") { isRunning = false; clearInterval(timerInterval); if (s === "DNF" || s === "DNS") { currentTotalMs = 0; elapsedBeforePause = 0; penaltyCount = 0; penaltyTime = 0; bonusCount = 0; bonusTime = 0; document.getElementById('display').innerText = "--:--:--.--"; syncPopupTime(s); } document.getElementById('startBtn').disabled = true; document.getElementById('stopBtn').disabled = true; document.getElementById('saveBtn').disabled = false; document.getElementById('runnerName').disabled = true; } updateAdjustmentNoticeDisplay(); }
        function updateAdjustmentNoticeDisplay() { const n = document.getElementById('adjustmentNotice'); if (currentStatus !== "REGULÄR") { n.innerText = `Status: ${currentStatus}`; n.className = "adjustment-display status-info"; } else { let t = ""; if (penaltyTime > 0) t += `+${penaltyTime}s`; if (bonusTime > 0) t += ` -${bonusTime}s`; n.innerText = t.trim(); n.className = `adjustment-display ${penaltyTime >= bonusTime ? 'penalty' : 'bonus'}`; } syncPopupNotice(); }
        

                function saveRun() {
            const runnerName = document.getElementById('runnerName').value.trim();
            if (!runnerName) {
                alert(translations['lblEnterRunnerName'] || "Bitte Läufernamen eingeben.");
                return;
            }

            // NEU: Läufer im globalen Register speichern
            registerRunner(runnerName);

            runs.push({
                id: Date.now() + Math.random(),
                name: runnerName,
                timeMs: currentTotalMs,
                timeString: (currentStatus === "DNF" || currentStatus === "DNS") ? currentStatus : formatTime(currentTotalMs),
                status: currentStatus,
                penalties: { count: penaltyCount, time: penaltyTime },
                bonuses: { count: bonusCount, time: bonusTime }
            });
            
            saveRunsForCurrentEvent();
            sortAndDisplayRuns();
            resetForm();
        }

        function resetForm() { isRunning = false; isPaused = false; clearInterval(timerInterval); elapsedBeforePause = 0; currentTotalMs = 0; penaltyCount = 0; penaltyTime = 0; bonusCount = 0; bonusTime = 0; currentStatus = "REGULÄR"; const isLocked = lockedEvents.includes(currentEvent); document.getElementById('timingCard').style.display = isLocked ? 'none' : 'block'; document.getElementById('runnerName').value = ""; document.getElementById('runnerName').disabled = isLocked; document.getElementById('display').innerText = "00:00:00.00"; document.getElementById('adjustmentNotice').innerText = ""; document.getElementById('startBtn').disabled = isLocked; document.getElementById('startBtn').innerText = translations['lblStartBtn'] || "Start"; document.getElementById('stopBtn').disabled = true; document.getElementById('saveBtn').disabled = true; document.getElementById('statusBtnDNS').disabled = isLocked; document.getElementById('statusBtnDNF').disabled = isLocked; document.getElementById('statusBtnDNQ').disabled = true; document.getElementById('addPenaltyTypeBtn').disabled = isLocked; document.getElementById('addBonusTypeBtn').disabled = isLocked; renderCustomButtons('penalty'); renderCustomButtons('bonus'); groupRunners = []; renderGroupRunners(); document.getElementById('groupSetupForm').style.display = 'block'; document.getElementById('groupMassActionRow').style.display = 'none'; syncPopupRunnerName(); syncPopupTime(isLocked ? (translations['lblTimerBlocked'] || "GEBLOCKT") : "00:00:00.00"); syncPopupNotice(); }

         // Hilfsfunktion zum Auslesen der Event-Einstellungen
        function getEventSettings(eventName) {
            const defaultSettings = { mode: 'fastest', targetTimeMs: 0 };
            const saved = localStorage.getItem(`runnerEventSettings_${eventName}`);
            return saved ? JSON.parse(saved) : defaultSettings;
        }

        function sortAndDisplayRuns(isExportMode = false) {
            const settings = getEventSettings(currentEvent);
            const mode = settings.mode;
            const targetMs = settings.targetTimeMs;

            runs.sort((a, b) => { 
                const ord = { "REGULÄR": 1, "DNQ": 2, "DNF": 3, "DNS": 4 }; 
                if (ord[a.status] !== ord[b.status]) return ord[a.status] - ord[b.status]; 
                
                if (a.status === "REGULÄR" || a.status === "DNQ") {
                    if (mode === 'fastest') return a.timeMs - b.timeMs;
                    if (mode === 'slowest') return b.timeMs - a.timeMs;
                    if (mode === 'target') return Math.abs(a.timeMs - targetMs) - Math.abs(b.timeMs - targetMs);
                }
                return a.name.localeCompare(b.name); 
            });

            const ol = document.getElementById('leaderboard'); ol.innerHTML = "";
            document.getElementById('leaderboardHeader').style.display = runs.length > 0 ? 'flex' : 'none';
            if (runs.length === 0) { ol.innerHTML = `<li class="empty-state">${translations['lblEmptyLeaderboard'] || 'Noch keine Läufe.'}</li>`; if (popupWindow && !popupWindow.closed) syncPopupLeaderboard(); return; }
            
            const bestRun = runs.find(r => r.status === "REGULÄR" || r.status === "DNQ");
            const bestTimeMs = bestRun ? bestRun.timeMs : null;
            let currentRank = 1;

            runs.forEach((run, index) => {
                if (index > 0) {
                    const prevRun = runs[index - 1];
                    if ((run.status === "REGULÄR" || run.status === "DNQ") && (prevRun.status === "REGULÄR" || prevRun.status === "DNQ")) {
                        let isSameRank = false;
                        if (mode === 'target') isSameRank = Math.abs(run.timeMs - targetMs) === Math.abs(prevRun.timeMs - targetMs);
                        else isSameRank = run.timeMs === prevRun.timeMs;
                        if (!isSameRank) currentRank = index + 1;
                    } else { currentRank = index + 1; }
                }

                const li = document.createElement('li'); li.className = "leaderboard-item";
                let b = ''; if (run.status !== "REGULÄR") b += `<span class="badge badge-status">${run.status}</span>`; if (run.penalties?.time > 0) b += `<span class="badge badge-penalty">${run.penalties.count}x (+${run.penalties.time}s)</span>`; if (run.bonuses?.time > 0) b += `<span class="badge badge-bonus">${run.bonuses.count}x (-${run.bonuses.time}s)</span>`;
                
                let actionButtonsHTML = isExportMode ? '' : `<div class="mini-dropdown"><button class="btn-more-actions">⋮</button><div class="mini-dropdown-content"><button onclick="openEditModal(${run.id})">📝 ${translations['lblActionEdit'] || 'Bearbeiten'}</button><button onclick="openTransferModal(${run.id}, 'copy')">📋 ${translations['lblActionCopy'] || 'Kopieren'}</button><button onclick="openTransferModal(${run.id}, 'move')">➡️ ${translations['lblActionMove'] || 'Verschieben'}</button></div></div><button class="action-btn delete-btn" onclick="deleteRun(${run.id})">&times;</button>`;
                
                let diffHTML = '';
                if ((run.status === "REGULÄR" || run.status === "DNQ")) {
                    if (mode === 'target') {
                        const diff = run.timeMs - targetMs;
                        const sign = diff > 0 ? '+' : (diff < 0 ? '-' : '±');
                        diffHTML = `<span class="runner-diff">${sign}${formatTime(Math.abs(diff))}</span>`;
                    } else if (bestTimeMs !== null) {
                        const diffMs = mode === 'slowest' ? bestTimeMs - run.timeMs : run.timeMs - bestTimeMs;
                        if (diffMs > 0) diffHTML = `<span class="runner-diff">+${formatTime(diffMs)}</span>`;
                    }
                }

                let rankStr = '';
                // NEU: Nur noch reguläre Läufer bekommen eine Platzierung
                if (run.status === "REGULÄR") {
                    if (currentRank === 1) rankStr = '🥇'; else if (currentRank === 2) rankStr = '🥈'; else if (currentRank === 3) rankStr = '🥉'; else rankStr = `#${currentRank}`;
                }

                li.innerHTML = `<div class="runner-info"><span class="rank">${rankStr}</span><div><div class="runner-name-container">${getRunnerIconHTML(run.name, isExportMode)}<span class="runner-name">${escapeHTML(getCleanDisplayName(run.name))}</span></div><div class="stats-badges">${b}</div></div></div><div class="right-side-container"><div class="time-block"><span class="runner-time">${run.timeString}</span>${diffHTML}</div>${actionButtonsHTML}</div>`;
                ol.appendChild(li);
            });
            if (!isExportMode && popupWindow && !popupWindow.closed) syncPopupLeaderboard();
        }
        
        
        function deleteRun(id) { 
            const runIndex = runs.findIndex(r => r.id === id);
            if (runIndex === -1) return;
            const run = runs[runIndex];
            
            // In den Papierkorb verschieben
            const trash = JSON.parse(localStorage.getItem('runnerTrash')) || { events: [], runs: [] };
            trash.runs.push({ trashId: Date.now() + Math.random(), deletedAt: Date.now(), eventName: currentEvent, runData: run });
            localStorage.setItem('runnerTrash', JSON.stringify(trash));

            runs.splice(runIndex, 1);
            saveRunsForCurrentEvent(); 
            sortAndDisplayRuns(); 
        }
        
        
        function openEditModal(id) {
            const run = runs.find(r => r.id === id); if (!run) return;
            document.getElementById('editRunId').value = run.id; document.getElementById('editRunnerName').value = run.name; document.getElementById('editStatus').value = run.status;
            let totalMs = run.timeMs || 0;
            document.getElementById('editHours').value = Math.floor(totalMs / 3600000); document.getElementById('editMinutes').value = Math.floor((totalMs % 3600000) / 60000); document.getElementById('editSeconds').value = Math.floor((totalMs % 60000) / 1000); document.getElementById('editHundredths').value = Math.floor((totalMs % 1000) / 10);
            document.getElementById('editPenaltyCount').value = run.penalties ? run.penalties.count : 0; document.getElementById('editPenaltyTime').value = run.penalties ? run.penalties.time : 0;
            document.getElementById('editBonusCount').value = run.bonuses ? run.bonuses.count : 0; document.getElementById('editBonusTime').value = run.bonuses ? run.bonuses.time : 0;
            toggleEditTimeField(); document.getElementById('editModal').style.display = 'flex';
        }
        function closeEditModal() { document.getElementById('editModal').style.display = 'none'; }
        function toggleEditTimeField() { document.getElementById('editTimeGroup').style.display = (document.getElementById('editStatus').value === "DNF" || document.getElementById('editStatus').value === "DNS") ? 'none' : 'flex'; }
        
                        function submitEditRun() {
            const id = parseFloat(document.getElementById('editRunId').value); 
            const index = runs.findIndex(r => r.id === id); 
            if (index === -1) return;
            
            const oldName = runs[index].name;
            const newName = document.getElementById('editRunnerName').value.trim() || "Unbekannt";
            
            // NEU: Globale Umbenennung aufrufen, wenn der Name abweicht
            if (oldName !== newName) {
                renameRunnerGlobally(oldName, newName);
            } else {
                // Migration alter Läufer, auch wenn der Name nicht geändert wurde
                registerRunner(newName);
            }

            const stat = document.getElementById('editStatus').value; 
            let timeMs = 0;
            let pCount = parseInt(document.getElementById('editPenaltyCount').value, 10) || 0; 
            let pTime = parseInt(document.getElementById('editPenaltyTime').value, 10) || 0;
            let bCount = parseInt(document.getElementById('editBonusCount').value, 10) || 0; 
            let bTime = parseInt(document.getElementById('editBonusTime').value, 10) || 0;
            
            if (stat !== "DNF" && stat !== "DNS") {
                timeMs = (parseInt(document.getElementById('editHours').value, 10)||0)*3600000 + 
                         (parseInt(document.getElementById('editMinutes').value, 10)||0)*60000 + 
                         (parseInt(document.getElementById('editSeconds').value, 10)||0)*1000 + 
                         (parseInt(document.getElementById('editHundredths').value, 10)||0)*10;
            } else { 
                pCount = 0; pTime = 0; bCount = 0; bTime = 0; 
            }
            
            // Aktualisieren des spezifischen Laufs 
            runs[index] = { 
                id: id, 
                name: newName, 
                status: stat, 
                timeMs: timeMs, 
                timeString: (stat==="DNF"||stat==="DNS") ? stat : formatTime(timeMs), 
                penalties: { count: pCount, time: pTime }, 
                bonuses: { count: bCount, time: bTime } 
            };
            
            saveRunsForCurrentEvent(); 
            sortAndDisplayRuns(); 
            
            closeEditModal();
        }


        

        function exportJSONData() { 
            if (runs.length === 0) return;
            const isLocked = lockedEvents.includes(currentEvent);
            const exportPayload = {
                eventName: currentEvent,
                isLocked: isLocked,
                runs: runs
            };
            const data = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportPayload, null, 2)); 
            const a = document.createElement('a'); 
            a.setAttribute("href", data); 
            a.setAttribute("download", `Bestenliste_${currentEvent.replace(/[^a-z0-9]/gi, '_')}.json`); 
            document.body.appendChild(a); 
            a.click(); 
            a.remove(); 
        }
        
        function triggerJSONImport() { if (!lockedEvents.includes(currentEvent)) document.getElementById('jsonImportInput').click(); }

        function openScreenPopup() {
            if (popupWindow && !popupWindow.closed) { popupWindow.focus(); return; }
            popupWindow = window.open("", "LeinwandAnsicht", "width=1000,height=600,scrollbars=yes,resizable=yes");
            popupWindow.document.write(`<!DOCTYPE html><html><head><title>Live-Anzeige</title><style>:root { --bg-color: #f4f7f6; --card-bg: #ffffff; --primary: #2c3e50; --accent: #3498db; --danger: #e74c3c; --success: #2ecc71; --text: #333333; --border-color: #dddddd; --penalty: #f39c12; --bonus: #9b59b6; --status: #7f8c8d; } [data-theme="dark"] { --bg-color: #1a1a1a; --card-bg: #2d2d2d; --primary: #ecf0f1; --accent: #5dade2; --text: #e0e0e0; --border-color: #444444; } body { font-family: 'Segoe UI', Arial, sans-serif; background-color: var(--bg-color); color: var(--text); margin: 0; padding: 20px; height: 100vh; box-sizing: border-box; display: flex; gap: 20px; } .left-pane { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; background: var(--card-bg); border-radius: 12px; padding: 30px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); text-align: center; overflow-y: auto; } .right-pane { width: 350px; background: var(--card-bg); border-radius: 12px; padding: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); display: flex; flex-direction: column; overflow: hidden; } #pRunnerName { font-size: 2.5rem; font-weight: bold; color: var(--accent); margin: 0 0 20px 0; min-height: 3.5rem; word-break: break-word; } #pDisplay { font-family: 'Courier New', monospace; font-size: 5.5rem; font-weight: bold; color: var(--primary); letter-spacing: 2px; margin: 20px 0; } #pNotice { font-size: 1.8rem; font-weight: 600; min-height: 2.5rem; } .notice-penalty { color: var(--danger); } .notice-bonus { color: var(--success); } .notice-status { color: var(--status); } h2 { margin-top: 0; border-bottom: 2px solid var(--bg-color); padding-bottom: 10px; font-size: 1.4rem; color: var(--primary); } .pop-list { list-style: none; padding: 0; margin: 0; overflow-y: auto; flex: 1; } .pop-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 5px; border-bottom: 1px solid var(--border-color); font-size: 1.05rem; } .pop-rank { font-weight: bold; color: var(--accent); margin-right: 10px; } .pop-time { font-family: 'Courier New', monospace; font-weight: bold; } .p-badge { font-size: 0.7rem; padding: 1px 4px; border-radius: 3px; color: white; font-weight: bold; margin-left: 4px; display: inline-block; } .pb-p { background-color: var(--penalty); } .pb-b { background-color: var(--bonus); } .pb-s { background-color: var(--status); } .multi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px; width: 100%; } .multi-box { background: var(--bg-color); padding: 15px; border-radius: 8px; box-shadow: inset 0 0 5px rgba(0,0,0,0.05); } .multi-name { font-size: 1.5rem; font-weight: bold; color: var(--accent); } .multi-time { font-family: 'Courier New', monospace; font-size: 2.5rem; font-weight: bold; margin: 10px 0; } .pop-name-container { display: flex; align-items: center; gap: 6px; } .pop-icon { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; font-size: 1.05rem; }</style></head><body><div class="left-pane" id="pLeftPane"><div id="pRunnerName">Bereit...</div><div id="pDisplay">00:00:00.00</div><div id="pNotice"></div></div><div class="right-pane"><h2 id="pPopHeader">🏆 Bestenliste</h2><ol id="pLeaderboard" class="pop-list"></ol></div></body></html>`);
            popupWindow.document.close(); syncPopupTheme(); syncPopupRunnerName(); syncPopupNotice(); syncPopupLeaderboard();
        }

        function syncPopupTheme() { if (popupWindow && !popupWindow.closed) popupWindow.document.documentElement.setAttribute('data-theme', document.documentElement.getAttribute('data-theme') || 'light'); }
        function syncPopupRunnerName() { if (!popupWindow || popupWindow.closed || activeTab === 'group') return; popupWindow.document.getElementById('pRunnerName').innerText = getCleanDisplayName(document.getElementById('runnerName').value.trim()) || (lockedEvents.includes(currentEvent) ? (translations['lblLobbyLocked'] || "Gesperrt") : (translations['lblLobbyReady'] || "Bereit...")); }
        function syncPopupTime(t) { if (popupWindow && !popupWindow.closed && activeTab === 'single') popupWindow.document.getElementById('pDisplay').innerText = t; }
        function syncPopupNotice() { if (!popupWindow || popupWindow.closed || activeTab === 'group') return; const el = popupWindow.document.getElementById('pNotice'); if (currentStatus !== "REGULÄR") { el.innerText = `Status: ${currentStatus}`; el.className = "notice-status"; } else { el.innerText = ((penaltyTime > 0 ? `+${penaltyTime}s ` : '') + (bonusTime > 0 ? `-${bonusTime}s` : '')).trim(); el.className = penaltyTime >= bonusTime ? "notice-penalty" : "notice-bonus"; } }
        
                function syncPopupLeaderboard() {
            if (!popupWindow || popupWindow.closed) return;
            
            popupWindow.document.getElementById('pPopHeader').innerText = translations['lblLeaderboardTitle'] || "🏆 Bestenliste";
            const pOl = popupWindow.document.getElementById('pLeaderboard'); 
            pOl.innerHTML = "";
            
            const settings = getEventSettings(currentEvent);
            const mode = settings.mode;
            const targetMs = settings.targetTimeMs;

            if (runs.length === 0) {
                pOl.innerHTML = `<li style="text-align:center;color:#7f8c8d;font-style:italic;padding-top:20px;">${translations['lblEmptyLeaderboard'] || 'Keine Läufe'}</li>`;
            } else {
                const bestRun = runs.find(r => r.status === "REGULÄR" || r.status === "DNQ");
                const bestTimeMs = bestRun ? bestRun.timeMs : null;
                let currentRank = 1;

                runs.forEach((run, index) => { 
                    if (index > 0) {
                        const prevRun = runs[index - 1];
                        if ((run.status === "REGULÄR" || run.status === "DNQ") && (prevRun.status === "REGULÄR" || prevRun.status === "DNQ")) {
                            let isSameRank = false;
                            if (mode === 'target') {
                                isSameRank = Math.abs(run.timeMs - targetMs) === Math.abs(prevRun.timeMs - targetMs);
                            } else {
                                isSameRank = run.timeMs === prevRun.timeMs;
                            }
                            if (!isSameRank) currentRank = index + 1;
                        } else if (run.status !== "REGULÄR" && run.status !== "DNQ") { 
                            currentRank = index + 1; 
                        }
                    }

                    const li = popupWindow.document.createElement('li'); 
                    li.className = "pop-item"; 
                    
                    let tags = (run.status !== "REGULÄR" ? `<span class="p-badge pb-s">${run.status}</span>` : '') + 
                               (run.penalties?.time > 0 ? `<span class="p-badge pb-p">+${run.penalties.time}s</span>` : '') + 
                               (run.bonuses?.time > 0 ? `<span class="p-badge pb-b">-${run.bonuses.time}s</span>` : ''); 
                    
                    let diffHTML = '';
                    if ((run.status === "REGULÄR" || run.status === "DNQ")) {
                        if (mode === 'target') {
                            const diff = run.timeMs - targetMs;
                            const sign = diff > 0 ? '+' : (diff < 0 ? '-' : '±');
                            diffHTML = `<div style="font-size:0.8rem; color:var(--danger); text-align:right; font-family:'Courier New',monospace; font-weight:bold; margin-top:2px;">${sign}${formatTime(Math.abs(diff))}</div>`;
                        } else if (bestTimeMs !== null) {
                            const diffMs = mode === 'slowest' ? bestTimeMs - run.timeMs : run.timeMs - bestTimeMs;
                            if (diffMs > 0) {
                                diffHTML = `<div style="font-size:0.8rem; color:var(--danger); text-align:right; font-family:'Courier New',monospace; font-weight:bold; margin-top:2px;">+${formatTime(diffMs)}</div>`;
                            }
                        }
                    }

                    let rankStr = '';
                    // NEU: Auch in der Leinwand bekommen nur reguläre Läufe eine Platzierung
                    if (run.status === "REGULÄR") {
                        if (currentRank === 1) rankStr = '🥇'; 
                        else if (currentRank === 2) rankStr = '🥈'; 
                        else if (currentRank === 3) rankStr = '🥉'; 
                        else rankStr = `#${currentRank}`;
                    }

                    li.innerHTML = `<div class="pop-name-container"><span class="pop-rank">${rankStr}</span>${getRunnerIconHTML(run.name, false)}<span>${escapeHTML(getCleanDisplayName(run.name))}${tags}</span></div><div style="display:flex; flex-direction:column; align-items:flex-end; justify-content:center;"><div class="pop-time">${run.timeString}</div>${diffHTML}</div>`; 
                    pOl.appendChild(li); 
                });
            }
            
            const leftPane = popupWindow.document.getElementById('pLeftPane');
            if (activeTab === 'single') { 
                if (!popupWindow.document.getElementById('pDisplay')) { 
                    leftPane.innerHTML = '<div id="pRunnerName">Bereit...</div><div id="pDisplay">00:00:00.00</div><div id="pNotice"></div>'; 
                    syncPopupRunnerName(); 
                    syncPopupNotice(); 
                } 
            } else { 
                if (groupRunners.length === 0) {
                    leftPane.innerHTML = `<div style="font-size:2rem; font-weight:bold; color:var(--text-light)">${translations['lblGroupSetup'] || 'Gruppenlauf: Bereitstellung...'}</div>`; 
                } else { 
                    leftPane.innerHTML = `<div class="multi-grid">${groupRunners.map(r => `<div class="multi-box"><div class="multi-name">${escapeHTML(getCleanDisplayName(r.name))} ${r.status !== 'REGULÄR' ? '[' + r.status + ']' : ''}</div><div class="multi-time">${r.status === 'DNF' || r.status === 'DNS' ? r.status : formatTime(r.timeMs)}</div><div style="font-size:0.9rem; color:var(--text-light)">${translations['lblEditPenaltyCount'] || 'Strafen'}: +${r.penalties.time}s | ${translations['lblEditBonusCount'] || 'Boni'}: -${r.bonuses.time}s</div></div>`).join('')}</div>`; 
                } 
            }
        }

        

        function prepareExportStyles() {
    const element = document.getElementById('leaderboardCard');
    const cardHeader = document.getElementById('cardHeader');
    const pdfEventTitle = document.getElementById('pdfEventTitle');

    pdfEventTitle.innerText = currentEvent === 'Standardlauf' ? (translations['lblLeaderboardTitle'] || "Bestenliste") : currentEvent;
    
    cardHeader.style.display = 'none'; 
    pdfEventTitle.style.display = 'block'; 
    element.classList.add('pdf-export-mode');
    sortAndDisplayRuns(true);

    // Wasserzeichen direkt aus der Variable injizieren (kein fetch mehr nötig)
    if (watermarkText && !document.getElementById('exportWatermark')) {
        const wm = document.createElement('div');
        wm.id = 'exportWatermark';
        wm.style.cssText = 'margin-top:20px; font-size:0.7rem; color:#888; text-align:center; border-top:1px solid #ccc; padding-top:5px;';
        wm.innerText = watermarkText;
        element.appendChild(wm);
    }

    return () => { 
        cardHeader.style.display = 'flex'; 
        pdfEventTitle.style.display = 'none'; 
        element.classList.remove('pdf-export-mode'); 
        const wm = document.getElementById('exportWatermark'); 
        if(wm) wm.remove();
        sortAndDisplayRuns(false);
    };
}

        function exportToPDF() { if (runs.length === 0) return; const reset = prepareExportStyles(); setTimeout(() => { html2pdf().set({ margin: 15, filename: `Bestenliste_${currentEvent.replace(/[^a-z0-9]/gi, '_')}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: false, logging: false }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } }).from(document.getElementById('leaderboardCard')).save().then(reset).catch(reset); }, 150); }
        async function shareAsImage() { if (runs.length === 0) return; const reset = prepareExportStyles(); try { setTimeout(async () => { const canvas = await html2canvas(document.getElementById('leaderboardCard'), { scale: 2, backgroundColor: '#ffffff', useCORS: false }); reset(); canvas.toBlob(async (blob) => { const file = new File([blob], 'bestenliste.png', { type: 'image/png' }); if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Ergebnisse' }); else { const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = 'Bestenliste.png'; a.click(); } }); }, 150); } catch { reset(); } }
        function escapeHTML(str) { return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)); }
  
        function deleteAllAppData() {
    const confirmation = confirm(translations['lblConfirmDeleteAll'] || "Wirklich alle Daten löschen?");
    if (confirmation) {
        localStorage.clear();
        // Kurze Verzögerung für den Nutzer, dann Neuladen
        location.reload();
    }
}

   


        // --- PAPIERKORB LOGIK ---
        function openTrashModal() {
            const trash = JSON.parse(localStorage.getItem('runnerTrash')) || { events: [], runs: [] };
            const eventsCont = document.getElementById('trashEventsContainer');
            const runsCont = document.getElementById('trashRunsContainer');
            const emptyMsg = document.getElementById('trashEmptyMsg');
            const lblEvents = document.getElementById('lblTrashEvents');
            const lblRuns = document.getElementById('lblTrashRuns');

            eventsCont.innerHTML = ''; runsCont.innerHTML = '';

            if (trash.events.length === 0 && trash.runs.length === 0) {
                lblEvents.style.display = 'none'; lblRuns.style.display = 'none'; emptyMsg.style.display = 'block';
                emptyMsg.innerText = translations['lblTrashEmpty'] || "Der Papierkorb ist leer.";
            } else {
                emptyMsg.style.display = 'none';
                lblEvents.style.display = trash.events.length > 0 ? 'block' : 'none';
                lblRuns.style.display = trash.runs.length > 0 ? 'block' : 'none';

                trash.events.forEach(te => {
                    const div = document.createElement('div'); div.className = 'trash-item';
                    const d = new Date(te.deletedAt).toLocaleString();
                    div.innerHTML = `
                        <div class="trash-item-info">
                            <span class="trash-item-title">🏆 ${escapeHTML(te.eventName)}</span>
                            <span class="trash-item-sub">Gelöscht: ${d} | ${te.runsData.length} Läufe</span>
                        </div>
                        <div class="trash-actions">
                            <button class="btn-trash-action btn-restore" onclick="restoreTrashEvent(${te.trashId})">${translations['lblRestoreBtn'] || 'Wiederherstellen'}</button>
                            <button class="btn-trash-action btn-perm-delete" onclick="permDeleteTrashEvent(${te.trashId})">❌</button>
                        </div>
                    `;
                    eventsCont.appendChild(div);
                });

                trash.runs.forEach(tr => {
                    const div = document.createElement('div'); div.className = 'trash-item';
                    const d = new Date(tr.deletedAt).toLocaleString();
                    div.innerHTML = `
                        <div class="trash-item-info">
                            <span class="trash-item-title">🏃 ${escapeHTML(getCleanDisplayName(tr.runData.name))} (${tr.runData.timeString})</span>
                            <span class="trash-item-sub">Event: ${escapeHTML(tr.eventName)} | Gelöscht: ${d}</span>
                        </div>
                        <div class="trash-actions">
                            <button class="btn-trash-action btn-restore" onclick="restoreTrashRun(${tr.trashId})">${translations['lblRestoreBtn'] || 'Wiederherstellen'}</button>
                            <button class="btn-trash-action btn-perm-delete" onclick="permDeleteTrashRun(${tr.trashId})">❌</button>
                        </div>
                    `;
                    runsCont.appendChild(div);
                });
            }
            document.getElementById('trashModal').style.display = 'flex';
        }

        function closeTrashModal() { document.getElementById('trashModal').style.display = 'none'; }

        function restoreTrashEvent(trashId) {
            let trash = JSON.parse(localStorage.getItem('runnerTrash')) || { events: [], runs: [] };
            const index = trash.events.findIndex(e => e.trashId === trashId);
            if(index === -1) return;
            const te = trash.events[index];

            if (eventList.includes(te.eventName)) { alert(translations['lblErrorRestoreEventExists'] || "Existiert bereits."); return; }

            eventList.push(te.eventName); localStorage.setItem('runnerEventList', JSON.stringify(eventList));
            if (te.isLocked) { lockedEvents.push(te.eventName); localStorage.setItem('runnerLockedEvents', JSON.stringify(lockedEvents)); }
            localStorage.setItem(`runnerLeaderboard_${te.eventName}`, JSON.stringify(te.runsData));

            trash.events.splice(index, 1); localStorage.setItem('runnerTrash', JSON.stringify(trash));
            buildEventSelectMenu(); openTrashModal();
        }

        function permDeleteTrashEvent(trashId) {
            let trash = JSON.parse(localStorage.getItem('runnerTrash')) || { events: [], runs: [] };
            trash.events = trash.events.filter(e => e.trashId !== trashId);
            localStorage.setItem('runnerTrash', JSON.stringify(trash)); openTrashModal();
        }

                function restoreTrashRun(trashId) {
            let trash = JSON.parse(localStorage.getItem('runnerTrash')) || { events: [], runs: [] };
            const index = trash.runs.findIndex(r => r.trashId === trashId);
            if(index === -1) return;
            const tr = trash.runs[index];

            // Wenn das Ursprungs-Event gelöscht wurde -> Neues Fenster öffnen
            if (!eventList.includes(tr.eventName)) { 
                openRestoreMissingModal(trashId);
                return; 
            }

            // Normaler Ablauf, wenn Event noch existiert
            let eventRuns = JSON.parse(localStorage.getItem(`runnerLeaderboard_${tr.eventName}`)) || [];
            eventRuns.push(tr.runData);
            localStorage.setItem(`runnerLeaderboard_${tr.eventName}`, JSON.stringify(eventRuns));

            if (currentEvent === tr.eventName) { runs = eventRuns; sortAndDisplayRuns(); }

            trash.runs.splice(index, 1); 
            localStorage.setItem('runnerTrash', JSON.stringify(trash)); 
            openTrashModal(); // Papierkorb aktualisieren
        }

        // --- NEU: LOGIK WENN EVENT BEIM WIEDERHERSTELLEN FEHLT ---
        function openRestoreMissingModal(trashId) {
            document.getElementById('restoreMissingTrashId').value = trashId;
            const select = document.getElementById('restoreMissingTargetEvent');
            select.innerHTML = '';
            
            eventList.forEach(ev => {
                const opt = document.createElement('option');
                opt.value = ev;
                opt.innerText = (lockedEvents.includes(ev) ? '🔒 ' : '') + (ev === 'Standardlauf' ? (translations['lblStandardRun'] || 'Standardlauf') : '🏆 ' + ev);
                select.appendChild(opt);
            });
            
            // Papierkorb kurz ausblenden, damit das neue Fenster im Fokus steht
            document.getElementById('trashModal').style.display = 'none'; 
            document.getElementById('restoreMissingModal').style.display = 'flex';
        }

        function closeRestoreMissingModal() {
            document.getElementById('restoreMissingModal').style.display = 'none';
            document.getElementById('trashModal').style.display = 'flex'; // Papierkorb wieder zeigen
        }

        function submitRestoreMissing() {
            const trashId = parseFloat(document.getElementById('restoreMissingTrashId').value);
            const targetEvent = document.getElementById('restoreMissingTargetEvent').value;
            
            let trash = JSON.parse(localStorage.getItem('runnerTrash')) || { events: [], runs: [] };
            const index = trash.runs.findIndex(r => r.trashId === trashId);
            if(index === -1) { closeRestoreMissingModal(); return; }
            const tr = trash.runs[index];

            // In das neu gewählte Event einfügen
            let eventRuns = JSON.parse(localStorage.getItem(`runnerLeaderboard_${targetEvent}`)) || [];
            eventRuns.push(tr.runData);
            localStorage.setItem(`runnerLeaderboard_${targetEvent}`, JSON.stringify(eventRuns));

            if (currentEvent === targetEvent) { runs = eventRuns; sortAndDisplayRuns(); }

            // Aus Papierkorb entfernen
            trash.runs.splice(index, 1); 
            localStorage.setItem('runnerTrash', JSON.stringify(trash)); 
            
            document.getElementById('restoreMissingModal').style.display = 'none';
            openTrashModal(); // Papierkorb mit frischen Daten wieder öffnen
        }


        function permDeleteTrashRun(trashId) {
            let trash = JSON.parse(localStorage.getItem('runnerTrash')) || { events: [], runs: [] };
            trash.runs = trash.runs.filter(r => r.trashId !== trashId);
            localStorage.setItem('runnerTrash', JSON.stringify(trash)); openTrashModal();
        }

        // --- EVENT UMBENENNEN LOGIK ---
function openEventRenameModal() {
    if (currentEvent === 'Standardlauf') {
        alert(translations['lblErrorCannotRenameStandard'] || "Der Standardlauf kann nicht umbenannt werden.");
        return;
    }
    document.getElementById('eventRenameModal').style.display = 'flex';
    document.getElementById('renameEventName').value = currentEvent;
    document.getElementById('renameEventName').focus();
}

function closeEventRenameModal() {
    document.getElementById('eventRenameModal').style.display = 'none';
    document.getElementById('renameEventName').value = '';
}

function renameCurrentEvent() {
    const oldName = currentEvent;
    const newName = document.getElementById('renameEventName').value.trim();
    
    if (!newName) {
        alert(translations['lblErrorNoEventName'] || "Bitte Eventnamen eingeben.");
        return;
    }
    if (newName === oldName) {
        closeEventRenameModal();
        return;
    }
    if (eventList.includes(newName)) {
        alert(translations['lblErrorEventExists'] || "Dieses Event existiert bereits.");
        return;
    }

    // 1. In der Event-Liste (Dropdown-Daten) aktualisieren
    const index = eventList.indexOf(oldName);
    if (index !== -1) {
        eventList[index] = newName;
        localStorage.setItem('runnerEventList', JSON.stringify(eventList));
    }

    // 2. Status in den gesperrten Events migrieren
    const lockIndex = lockedEvents.indexOf(oldName);
    if (lockIndex !== -1) {
        lockedEvents[lockIndex] = newName;
        localStorage.setItem('runnerLockedEvents', JSON.stringify(lockedEvents));
    }

    // 3. Bestenliste im LocalStorage komplett auf den neuen Key übertragen
    const leaderboardData = localStorage.getItem(`runnerLeaderboard_${oldName}`);
    if (leaderboardData) {
        localStorage.setItem(`runnerLeaderboard_${newName}`, leaderboardData);
        localStorage.removeItem(`runnerLeaderboard_${oldName}`);
    }
    // NEU: 3.5 Papierkorb migrieren ---
    let trash = JSON.parse(localStorage.getItem('runnerTrash'));
    if (trash && trash.runs) {
        let trashChanged = false;
        trash.runs.forEach(tr => {
            if (tr.eventName === oldName) {
                tr.eventName = newName; // Heimat aktualisieren
                trashChanged = true;
            }
        });
        if (trashChanged) {
            localStorage.setItem('runnerTrash', JSON.stringify(trash));
        }
    }

        // --- 3.8 Event-Einstellungen migrieren ---
    const eventSettings = localStorage.getItem(`runnerEventSettings_${oldName}`);
    if (eventSettings) {
        localStorage.setItem(`runnerEventSettings_${newName}`, eventSettings);
        localStorage.removeItem(`runnerEventSettings_${oldName}`);
    }

    
    // 4. Aktiven Lauf-Zeiger umstellen und speichern
    currentEvent = newName;
    localStorage.setItem('runnerCurrentEventName', currentEvent);

    // Benutzeroberfläche neu zeichnen
    buildEventSelectMenu();
    loadRunsForCurrentEvent();
    closeEventRenameModal();
}

        // --- TRANSFER LOGIK (KOPIEREN / VERSCHIEBEN) ---
        function openTransferModal(runId, mode) {
            const run = runs.find(r => r.id === runId);
            if (!run) return;
            
            document.getElementById('transferRunId').value = runId;
            document.getElementById('transferMode').value = mode;
            
            const titleEl = document.getElementById('lblTransferModalTitle');
            if (mode === 'copy') {
                titleEl.innerText = translations['lblTransferModalTitleCopy'] || "Lauf kopieren";
            } else {
                titleEl.innerText = translations['lblTransferModalTitleMove'] || "Lauf verschieben";
            }

            const select = document.getElementById('transferTargetEvent');
            select.innerHTML = '';
            let hasOptions = false;
            
            // Alle Events außer dem aktuellen auflisten
            eventList.forEach(ev => {
                if (ev !== currentEvent) {
                    const opt = document.createElement('option');
                    opt.value = ev;
                    opt.innerText = (lockedEvents.includes(ev) ? '🔒 ' : '') + (ev === 'Standardlauf' ? (translations['lblStandardRun'] || 'Standardlauf') : '🏆 ' + ev);
                    select.appendChild(opt);
                    hasOptions = true;
                }
            });

            if (!hasOptions) {
                alert(translations['lblErrorNoOtherEvents'] || "Es gibt keine anderen Events. Bitte legt zuerst ein weiteres an.");
                return;
            }

            document.getElementById('transferModal').style.display = 'flex';
        }

        function closeTransferModal() {
            document.getElementById('transferModal').style.display = 'none';
        }

        function submitTransferRun() {
            const runId = parseFloat(document.getElementById('transferRunId').value);
            const mode = document.getElementById('transferMode').value;
            const targetEvent = document.getElementById('transferTargetEvent').value;
            
            if (!targetEvent) {
                alert(translations['lblErrorNoTargetEvent'] || "Bitte ein Ziel-Event auswählen.");
                return;
            }

            const runIndex = runs.findIndex(r => r.id === runId);
            if (runIndex === -1) return;
            const run = runs[runIndex];

            // Ziel-Laufdaten holen
            let targetRuns = JSON.parse(localStorage.getItem(`runnerLeaderboard_${targetEvent}`)) || [];
            
            // Tiefe Kopie des Laufes erstellen und neue ID vergeben (verhindert ID-Konflikte)
            const runCopy = JSON.parse(JSON.stringify(run));
            runCopy.id = Date.now() + Math.random(); 
            
            targetRuns.push(runCopy);
            localStorage.setItem(`runnerLeaderboard_${targetEvent}`, JSON.stringify(targetRuns));

            // Wenn es "Verschieben" ist, aus dem aktuellen Event löschen
            if (mode === 'move') {
                runs.splice(runIndex, 1);
                saveRunsForCurrentEvent();
                sortAndDisplayRuns();
            }

            closeTransferModal();
        }

                // --- WERTUNGSMODUS LOGIK ---
        function openModeModal() {
            const settings = getEventSettings(currentEvent);
            document.getElementById('eventModeSelect').value = settings.mode;
            
            // Gespeicherte Millisekunden in H, M, S, FF aufteilen
            let msTotal = settings.targetTimeMs || 0;
            let h = Math.floor(msTotal / 3600000);
            msTotal %= 3600000;
            let m = Math.floor(msTotal / 60000);
            msTotal %= 60000;
            let s = Math.floor(msTotal / 1000);
            let ff = Math.floor((msTotal % 1000) / 10); // Hundertstel

            // Felder befüllen (nur wenn Wert > 0, ansonsten bleibt der Platzhalter sichtbar)
            document.getElementById('ttHours').value = h > 0 ? h.toString().padStart(2, '0') : '';
            document.getElementById('ttMinutes').value = m > 0 ? m.toString().padStart(2, '0') : '';
            document.getElementById('ttSeconds').value = s > 0 ? s.toString().padStart(2, '0') : '';
            document.getElementById('ttMs').value = ff > 0 ? ff.toString().padStart(2, '0') : '';

            toggleTargetTimeInput();
            document.getElementById('modeModal').style.display = 'flex';
        }

        function closeModeModal() {
            document.getElementById('modeModal').style.display = 'none';
        }

        function toggleTargetTimeInput() {
            const mode = document.getElementById('eventModeSelect').value;
            document.getElementById('targetTimeContainer').style.display = mode === 'target' ? 'block' : 'none';
        }

        function saveModeModal() {
            const mode = document.getElementById('eventModeSelect').value;
            let targetMs = 0;
            
            if (mode === 'target') {
                // Werte aus den 4 Feldern auslesen
                const h = parseInt(document.getElementById('ttHours').value) || 0;
                const m = parseInt(document.getElementById('ttMinutes').value) || 0;
                const s = parseInt(document.getElementById('ttSeconds').value) || 0;
                const ff = parseInt(document.getElementById('ttMs').value) || 0;

                // Alles in Millisekunden umrechnen (Hundertstel * 10 = Millisekunden)
                targetMs = (h * 3600000) + (m * 60000) + (s * 1000) + (ff * 10);

                if (targetMs === 0) {
                    alert("Bitte eine gültige Zielzeit (größer als 0) eingeben.");
                    return;
                }
            }

            const settings = { mode: mode, targetTimeMs: targetMs };
            localStorage.setItem(`runnerEventSettings_${currentEvent}`, JSON.stringify(settings));
            
            closeModeModal();
            sortAndDisplayRuns(); // Bestenliste greift sofort den neuen Modus auf
        }

        function parseTimeToMs(timeStr) {
            if (!timeStr) return 0;
            const parts = timeStr.replace(',', '.').split(':');
            let h = 0, m = 0, s = 0, ms = 0;
            if (parts.length === 3) {
                h = parseInt(parts[0]) || 0;
                m = parseInt(parts[1]) || 0;
                const secParts = parts[2].split('.');
                s = parseInt(secParts[0]) || 0;
                ms = secParts.length > 1 ? parseInt((secParts[1] + "00").substring(0, 2)) * 10 : 0;
            } else if (parts.length === 2) {
                m = parseInt(parts[0]) || 0;
                const secParts = parts[1].split('.');
                s = parseInt(secParts[0]) || 0;
                ms = secParts.length > 1 ? parseInt((secParts[1] + "00").substring(0, 2)) * 10 : 0;
            }
            return (h * 3600000) + (m * 60000) + (s * 1000) + ms;
        }

        
                // --- LÄUFERVERWALTUNG & STATISTIKEN ---
        let savedRegistry = JSON.parse(localStorage.getItem('runnerRegistry'));
                // --- LÄUFERVERWALTUNG & STATISTIKEN ---
        let runnerRegistry = [];
        try {
            const saved = localStorage.getItem('runnerRegistry');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) runnerRegistry = parsed;
            }
        } catch(e) {
            console.warn("Alte Läuferdaten zurückgesetzt.");
            runnerRegistry = [];
        }

        // NEU: Auto-Heiler! Holt die [Emojis] für alte Einträge aus den Event-Daten zurück
        let registryChanged = false;
        runnerRegistry = runnerRegistry.map(regName => {
            if (!regName.startsWith('[')) {
                for (let ev of eventList) {
                    const evRuns = JSON.parse(localStorage.getItem(`runnerLeaderboard_${ev}`)) || [];
                    const found = evRuns.find(r => getCleanDisplayName(r.name) === regName);
                    if (found && found.name !== regName) {
                        registryChanged = true;
                        return found.name; // Gibt den Namen inkl. [Emoji] zurück
                    }
                }
            }
            return regName;
        });
        if (registryChanged) localStorage.setItem('runnerRegistry', JSON.stringify(runnerRegistry));

        // NEU: Speichert nun immer den Namen inkl. Wappen
        function registerRunner(name) {
            if (!name) return;
            const cleanName = getCleanDisplayName(name);
            
            // Existiert der Läufer (anhand des sauberen Namens) bereits?
            const existingIndex = runnerRegistry.findIndex(n => getCleanDisplayName(n) === cleanName);
            
            if (existingIndex === -1) {
                runnerRegistry.push(name); // Vollen Namen in DB
                runnerRegistry.sort((a, b) => getCleanDisplayName(a).localeCompare(getCleanDisplayName(b)));
                localStorage.setItem('runnerRegistry', JSON.stringify(runnerRegistry));
            } else if (runnerRegistry[existingIndex] !== name) {
                // Das [Emoji] hat sich geändert! Wappen wird aktualisiert.
                runnerRegistry[existingIndex] = name;
                localStorage.setItem('runnerRegistry', JSON.stringify(runnerRegistry));
            }
        }


        function updateRunnerDatalist() {
            const dl = document.getElementById('registeredRunnersList');
            if (!dl) return;
            dl.innerHTML = '';
            runnerRegistry.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                dl.appendChild(opt);
            });
        }

        // -> WICHTIG: Erweitert Eure bestehende saveRun() Funktion!
        // Fügt dort direkt nach dem Auslesen des Namens "registerRunner(runnerName);" ein.
        // Falls Ihr eine saveGroupRuns() habt, dort ebenfalls "registerRunner(r.name);" für jeden Läufer einbauen.

                function openRunnerManagementModal() {
            // Sprach-Texte setzen
            document.getElementById('runnerSearch').placeholder = translations['lblRunnerSearchPlaceholder'] || "Läufer suchen...";
            document.getElementById('lblRunnerCloseBtn').innerText = translations['lblClose'] || "Schließen";

            renderRunnerManagementList();
            document.getElementById('rmRunnerStats').innerHTML = `<div style="color:var(--text-light); text-align:center; margin-top:20px;">${translations['lblSelectRunner'] || 'Wählt einen Läufer aus.'}</div>`;
            document.getElementById('runnerManagementModal').style.display = 'flex';
        }


        function closeRunnerManagementModal() { document.getElementById('runnerManagementModal').style.display = 'none'; }

        function filterRunners() {
            const query = document.getElementById('runnerSearch').value.toLowerCase();
            const list = document.getElementById('rmRunnerList');
            const items = list.querySelectorAll('.runner-list-item');
            items.forEach(item => {
                const name = item.innerText.toLowerCase();
                item.style.display = name.includes(query) ? 'flex' : 'none';
            });
        }

        function renderRunnerManagementList() {
            const listEl = document.getElementById('rmRunnerList');
            listEl.innerHTML = '';
            runnerRegistry.forEach(fullName => {
                const cleanName = getCleanDisplayName(fullName);
                const iconHTML = getRunnerIconHTML(fullName);

                const div = document.createElement('div');
                div.className = 'runner-list-item';
                div.innerHTML = `<div style="display:flex; align-items:center;">
                                    ${iconHTML} <span style="margin-left:8px;">${escapeHTML(cleanName)}</span>
                                 </div> 
                                 <button class="btn-delete-runner" title="${translations['lblActionDelete'] || 'Löschen'}" onclick="tryDeleteRunner(event, '${escapeHTML(cleanName)}')">🗑️</button>`;
                div.onclick = () => {
                    document.querySelectorAll('.runner-list-item').forEach(i => i.classList.remove('active'));
                    div.classList.add('active');
                    renderRunnerStats(fullName); // Stats erfordert nun den vollen Namen!
                };
                listEl.appendChild(div);
            });
        }

                function getRunnerTotalStats(runnerName) {
            let allRuns = [];
            eventList.forEach(ev => {
                const evRuns = JSON.parse(localStorage.getItem(`runnerLeaderboard_${ev}`)) || [];
                if (evRuns.length === 0) return;

                // Event-Einstellungen für die korrekte Sortierung abrufen
                const settings = getEventSettings(ev);
                const mode = settings.mode;
                const targetMs = settings.targetTimeMs;

                // Läufe exakt so sortieren wie in der Bestenliste
                evRuns.sort((a, b) => { 
                    const ord = { "REGULÄR": 1, "DNQ": 2, "DNF": 3, "DNS": 4 }; 
                    if (ord[a.status] !== ord[b.status]) return ord[a.status] - ord[b.status]; 
                    
                    if (a.status === "REGULÄR" || a.status === "DNQ") {
                        if (mode === 'fastest') return a.timeMs - b.timeMs;
                        if (mode === 'slowest') return b.timeMs - a.timeMs;
                        if (mode === 'target') return Math.abs(a.timeMs - targetMs) - Math.abs(b.timeMs - targetMs);
                    }
                    return a.name.localeCompare(b.name); 
                });

                let currentRank = 1;
                evRuns.forEach((run, index) => {
                    // Rangfolge berechnen (Gleichstand berücksichtigen)
                    if (index > 0) {
                        const prevRun = evRuns[index - 1];
                        if ((run.status === "REGULÄR" || run.status === "DNQ") && (prevRun.status === "REGULÄR" || prevRun.status === "DNQ")) {
                            let isSameRank = false;
                            if (mode === 'target') isSameRank = Math.abs(run.timeMs - targetMs) === Math.abs(prevRun.timeMs - targetMs);
                            else isSameRank = run.timeMs === prevRun.timeMs;
                            if (!isSameRank) currentRank = index + 1;
                        } else if (run.status !== "REGULÄR" && run.status !== "DNQ") { 
                            currentRank = index + 1; 
                        }
                    }

                    if (getCleanDisplayName(run.name) === runnerName) {
                        allRuns.push({ 
                            event: ev, 
                            timeMs: run.timeMs, 
                            timeString: run.timeString, 
                            status: run.status,
                            // Nur reguläre Läufe erhalten eine offizielle Platzierung (Medaille/Schnitt)
                            rank: (run.status === "REGULÄR") ? currentRank : null
                        });
                    }
                });
            });
            return allRuns;
        }


                    function renderRunnerStats(fullName) {
            const cleanName = getCleanDisplayName(fullName);
            const statsPane = document.getElementById('rmRunnerStats');
            const runs = getRunnerTotalStats(cleanName);
            const validRuns = runs.filter(r => r.status === "REGULÄR");
            
            let bestTimeMs = validRuns.length > 0 ? Math.min(...validRuns.map(r => r.timeMs)) : null;
            
            // NEU: Die gesamte gelaufene Zeit berechnen
            let totalTimeMs = 0;
            validRuns.forEach(r => {
                totalTimeMs += r.timeMs;
            });

            let gold = 0, silver = 0, bronze = 0, dns = 0, dnf = 0, dnq = 0, rankSum = 0, rankCount = 0;
            runs.forEach(r => {
                if (r.rank === 1) gold++; if (r.rank === 2) silver++; if (r.rank === 3) bronze++;
                if (r.rank !== null) { rankSum += r.rank; rankCount++; }
                if (r.status === "DNS") dns++; if (r.status === "DNF") dnf++; if (r.status === "DNQ") dnq++;
            });

            const totalMedals = gold + silver + bronze;
            const avgRank = rankCount > 0 ? (rankSum / rankCount).toFixed(1) : '-';

            let html = `<h4 style="margin-top:0; color:var(--primary); font-size: 1.4rem; display:flex; align-items:center;">
                            ${getRunnerIconHTML(fullName)} <span style="margin-left:8px;">${escapeHTML(cleanName)}</span>
                        </h4>`;
            
            // Das Grid wurde um die Gesamtzeit erweitert und optisch ausbalanciert
            html += `<div class="stat-card">
                        <div class="stat-card-title">${translations['lblOverview'] || 'Überblick'}</div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 0.95rem;">
                            <div>${translations['lblStatTotalRuns'] || 'Gesamtläufe:'} <b>${runs.length}</b></div>
                            <div>${translations['lblStatTotalTime'] || 'Gesamtzeit:'} <b>${totalTimeMs > 0 ? formatTime(totalTimeMs) : '-'}</b></div>
                            
                            <div>${translations['lblStatBestTime'] || 'Bestzeit:'} <b>${bestTimeMs ? formatTime(bestTimeMs) : '-'}</b></div>
                            <div>${translations['lblStatAvgRank'] || 'Ø Platzierung:'} <b>${avgRank}</b></div>
                            
                            <div style="border-top: 1px solid var(--border-color); padding-top: 8px; grid-column: 1 / -1;">
                                ${translations['lblStatTotalMedals'] || 'Medaillen gesamt:'} <b>${totalMedals}</b>
                            </div>
                            
                            <div>${translations['lblStatGold'] || '🥇 Gold:'} <b>${gold}</b></div>
                            <div>${translations['lblStatDNS'] || 'DNS:'} <b>${dns}</b></div>
                            
                            <div>${translations['lblStatSilver'] || '🥈 Silber:'} <b>${silver}</b></div>
                            <div>${translations['lblStatDNF'] || 'DNF:'} <b>${dnf}</b></div>
                            
                            <div>${translations['lblStatBronze'] || '🥉 Bronze:'} <b>${bronze}</b></div>
                            <div>${translations['lblStatDNQ'] || 'DNQ:'} <b>${dnq}</b></div>
                        </div>
                     </div>`;

            if (validRuns.length > 0) {
                html += `<div class="stat-card"><div class="stat-card-title">${translations['lblPerformanceChart'] || 'Leistungsverlauf'}</div><div style="position: relative; height: 250px; width: 100%;"><canvas id="runnerPerformanceChart"></canvas></div></div>`;
            } else {
                html += `<div style="color:var(--text-light); font-style:italic; font-size:0.9rem;">${translations['lblNoStatsAvailable'] || 'Keine regulären Laufzeiten für Grafiken vorhanden.'}</div>`;
            }

            statsPane.innerHTML = html;

            if (validRuns.length > 0) {
                const ctx = document.getElementById('runnerPerformanceChart').getContext('2d');
                if (runnerChartInstance) runnerChartInstance.destroy();
                const labels = validRuns.map(r => r.event); const dataPts = validRuns.map(r => r.timeMs);
                const rootStyle = getComputedStyle(document.documentElement);
                const primaryColor = rootStyle.getPropertyValue('--primary').trim() || '#3498db';
                const textColor = rootStyle.getPropertyValue('--text-light').trim() || '#7f8c8d';
                const gridColor = rootStyle.getPropertyValue('--border-color').trim() || '#e0e0e0';

                runnerChartInstance = new Chart(ctx, {
                    type: 'line', data: { labels: labels, datasets: [{ label: 'Laufzeit', data: dataPts, borderColor: primaryColor, backgroundColor: primaryColor + '33', borderWidth: 2, pointBackgroundColor: primaryColor, pointRadius: 4, pointHoverRadius: 6, fill: true, tension: 0.3 }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(context) { return ' ' + formatTime(context.raw); } } } }, scales: { y: { ticks: { color: textColor, callback: function(value) { return formatTime(value); } }, grid: { color: gridColor } }, x: { ticks: { color: textColor }, grid: { display: false } } } }
                });
            }
        }




        function tryDeleteRunner(e, cleanName) {
            e.stopPropagation();
            const runs = getRunnerTotalStats(cleanName);
            if (runs.length > 0) {
                alert(translations['lblRunnerInUseError'] || "Dieser Läufer ist noch in Events aktiv und kann nicht gelöscht werden.");
                return;
            }
            if (confirm(translations['lblRunnerDeleteConfirm'] || "Diesen Läufer wirklich aus der Datenbank entfernen?")) {
                runnerRegistry = runnerRegistry.filter(n => getCleanDisplayName(n) !== cleanName);
                localStorage.setItem('runnerRegistry', JSON.stringify(runnerRegistry));
                renderRunnerManagementList();
                document.getElementById('rmRunnerStats').innerHTML = `<div style="color:var(--text-light); text-align:center; margin-top:20px;">${translations['lblSelectRunner'] || 'Wählt einen Läufer aus.'}</div>`;
            }
        }
        
        function migrateAllOldRunners() {
        	//To add all non existing runners to StatsDB
    let addedCount = 0;
    eventList.forEach(ev => {
        const evRuns = JSON.parse(localStorage.getItem(`runnerLeaderboard_${ev}`)) || [];
        evRuns.forEach(r => {
            const cleanName = getCleanDisplayName(r.name);
            if (cleanName && !runnerRegistry.includes(cleanName)) {
                runnerRegistry.push(cleanName);
                addedCount++;
            }
        });
    });
    
    if (addedCount > 0) {
        runnerRegistry.sort((a, b) => a.localeCompare(b));
        localStorage.setItem('runnerRegistry', JSON.stringify(runnerRegistry));
        updateRunnerDatalist();
        alert(`Migration abgeschlossen! ${addedCount} alte Läufer wurden in die neue Datenbank importiert.`);
    } else {
        alert("Alle Läufer sind bereits in der Datenbank.");
    }
}

        function renameRunnerGlobally(oldName, newName) {
            const cleanOld = getCleanDisplayName(oldName);
            const cleanNew = getCleanDisplayName(newName);

            // 1. Aktuelles Event im Arbeitsspeicher aktualisieren
            // (Falls der Läufer im aktuellen Event mehrmals gelaufen ist)
            runs.forEach(r => {
                if (getCleanDisplayName(r.name) === cleanOld) {
                    r.name = newName;
                }
            });

            // 2. Alle anderen Events im Archiv (localStorage) aktualisieren
            eventList.forEach(ev => {
                if (ev === currentEvent) return; // Bereits in 'runs' erledigt
                
                let evRuns = JSON.parse(localStorage.getItem(`runnerLeaderboard_${ev}`)) || [];
                let changed = false;
                evRuns.forEach(r => {
                    if (getCleanDisplayName(r.name) === cleanOld) {
                        r.name = newName;
                        changed = true;
                    }
                });
                if (changed) {
                    localStorage.setItem(`runnerLeaderboard_${ev}`, JSON.stringify(evRuns));
                }
            });

            // 3. Papierkorb aktualisieren (falls der Läufer dort gelöschte Einträge hat)
            let trash = JSON.parse(localStorage.getItem('runnerTrash'));
            if (trash && trash.runs) {
                let trashChanged = false;
                trash.runs.forEach(tr => {
                    if (getCleanDisplayName(tr.runData.name) === cleanOld) {
                        tr.runData.name = newName;
                        trashChanged = true;
                    }
                });
                if (trashChanged) {
                    localStorage.setItem('runnerTrash', JSON.stringify(trash));
                }
            }

                        // 4. Läufer-Register (Statistik-DB) aktualisieren
            runnerRegistry = runnerRegistry.filter(n => getCleanDisplayName(n) !== cleanOld); 
            const cleanNewIndex = runnerRegistry.findIndex(n => getCleanDisplayName(n) === cleanNew);
            if (cleanNewIndex === -1) {
                runnerRegistry.push(newName); // Den VOLLEN neuen Namen rein
            } else {
                runnerRegistry[cleanNewIndex] = newName; // Wappen aktualisieren falls er schon existiert
            }
            runnerRegistry.sort((a, b) => getCleanDisplayName(a).localeCompare(getCleanDisplayName(b)));
            localStorage.setItem('runnerRegistry', JSON.stringify(runnerRegistry));

        }

        
                // --- CUSTOM AUTOCOMPLETE / LUPEN-SUCHE ---
        function toggleAutocomplete(inputId, dropdownId) {
            const dropdown = document.getElementById(dropdownId);
            
            // Wenn es schon offen ist, schließen
            if (dropdown.style.display === 'block') {
                dropdown.style.display = 'none';
            } else {
                // Alle anderen eventuell offenen Fenster schließen
                document.querySelectorAll('.autocomplete-dropdown').forEach(dd => dd.style.display = 'none');
                
                // Liste füllen und anzeigen
                updateLiveAutocomplete(inputId, dropdownId, true);
                dropdown.style.display = 'block';
            }
        }

                function updateLiveAutocomplete(inputId, dropdownId, forceUpdate = false) {
            const input = document.getElementById(inputId);
            const dropdown = document.getElementById(dropdownId);
            
            if (dropdown.style.display !== 'block' && !forceUpdate) return;

            const query = input.value.toLowerCase().trim();
            dropdown.innerHTML = '';
            
            const matches = runnerRegistry.filter(name => 
                getCleanDisplayName(name).toLowerCase().includes(query) || 
                name.toLowerCase().includes(query)
            );
            
            if (matches.length === 0) {
                // NEU: Sprachdatei für "Keine Treffer" wird abgefragt
                dropdown.innerHTML = `<div class="autocomplete-item" style="color:var(--text-light); font-style:italic; cursor:default;">${translations['lblNoMatches'] || 'Keine Treffer'}</div>`;
                return;
            }

            matches.forEach(fullName => {
                const cleanName = getCleanDisplayName(fullName);
                const iconHTML = getRunnerIconHTML(fullName); 
                
                const div = document.createElement('div');
                div.className = 'autocomplete-item';
                div.style.display = 'flex';
                div.style.alignItems = 'center';
                div.innerHTML = `${iconHTML} <span style="margin-left: 8px;">${escapeHTML(cleanName)}</span>`;
                div.onclick = () => {
                    input.value = fullName; 
                    dropdown.style.display = 'none';
                };
                dropdown.appendChild(div);
            });
        }
