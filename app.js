// --- 1. GENERATE UI COMPONENTS ---
// Main Synth Sliders
const panel = document.getElementById('synth-panel');
CONFIG.forEach(s => {
    let html = `<div class="section"><h3>${s.section}</h3><div class="controls-row">`;
    s.controls.forEach(c => {
        html += `<div class="control"><div class="target-popup" id="t-${c.id}"></div><div class="val-popup" id="v-${c.id}">-</div>
        <div class="slider-container"><div class="ghost-marker" id="g-${c.id}"></div><input type="range" id="${c.id}" min="${c.min}" max="${c.max}" value="${c.min}" oninput="update('${c.id}')"></div>
        <div class="label">${c.label}</div><button class="learn-btn" onclick="learn('${c.id}')">LEARN</button></div>`;
    });
    panel.innerHTML += html + `</div></div>`;
});

// Virtual Keyboard
const kb = document.getElementById('keyboard'); let wCount = 0;
for (let i = 48; i <= 84; i++) {
    const isBlack = [1, 3, 6, 8, 10].includes(i % 12); const key = document.createElement('div');
    key.className = 'key ' + (isBlack ? 'black' : 'white'); key.id = 'key-' + i;
    if (!isBlack) wCount++; else key.style.left = `calc(${wCount * (100 / 22)}%)`;
    kb.appendChild(key);
}

// Looper Tracks
const loopUI = document.getElementById('looper-ui');
for (let i = 0; i < 4; i++) {
    loopUI.innerHTML += `<div class="loop-track">
    <span style="font-size:10px; width:40px; font-weight:bold;">TRK ${i + 1}</span>
    <button id="rec-btn-${i}" class="btn-rec" onclick="toggleRec(${i})">RECORD</button>
    <button class="btn-clr" onclick="clearTrack(${i})">CLEAR</button>
</div>`;
}

// --- 4-TRACK SEQUENCER UI ---
const seqGrid = document.getElementById('seq-grid');
for (let i = 0; i < 16; i++) {
    let btn = document.createElement('div');
    btn.className = 'seq-step';
    btn.id = 'step-' + i;

    btn.onclick = () => {
        let currentTrack = seq.tracks[seq.viewTrack];
        currentTrack.steps[i].active = !currentTrack.steps[i].active;
        btn.classList.toggle('active', currentTrack.steps[i].active);
        selectSeqStep(i);
    };
    seqGrid.appendChild(btn);
}

// Initial Selection
if (document.getElementById('step-0')) document.getElementById('step-0').classList.add('selected');

// Track Switching Logic
function selectSeqTrack(trackIndex) {
    seq.viewTrack = trackIndex;

    // Update active button color
    document.querySelectorAll('.trk-sel').forEach((el, i) => {
        el.classList.toggle('active', i === trackIndex);
    });

    // Redraw the 16 steps to match the newly selected track
    const currentTrack = seq.tracks[trackIndex];
    for (let i = 0; i < 16; i++) {
        const btn = document.getElementById('step-' + i);
        btn.classList.toggle('active', currentTrack.steps[i].active);

        if (currentTrack.steps[i].cut > 0) btn.classList.add('has-lock');
        else btn.classList.remove('has-lock');
    }

    // Select step 0 on the new track by default
    selectSeqStep(0);
}

// Mute/Play Logic
function toggleSeqMute(trackIndex) {
    let track = seq.tracks[trackIndex];
    track.playing = !track.playing;

    // Find the specific mute button and update it
    const muteBtn = document.querySelector(`#seq-trk-${trackIndex} .trk-mute`);
    if (track.playing) {
        muteBtn.innerText = "PLAYING";
        muteBtn.classList.remove('muted');
    } else {
        muteBtn.innerText = "MUTED";
        muteBtn.classList.add('muted');
    }
}

// Sequencer Play/Stop
function toggleSeq() {
    seq.on = !seq.on;
    const b = document.getElementById('btn-seq');
    b.innerText = seq.on ? "SEQ: ON" : "SEQ: OFF";
    b.classList.toggle('active');

    if (!seq.on) {
        document.querySelectorAll('.seq-step').forEach(el => el.classList.remove('playing'));
        seq.currentStep = -1;
    }
}

// Step Editing
function selectSeqStep(i) {
    seq.selectedStep = i;
    document.querySelectorAll('.seq-step').forEach(el => el.classList.remove('selected'));
    document.getElementById('step-' + i).classList.add('selected');

    const currentTrack = seq.tracks[seq.viewTrack];
    document.getElementById('edit-step-num').innerText = i + 1;
    document.getElementById('seq-note').value = currentTrack.steps[i].note;
    document.getElementById('seq-cut').value = currentTrack.steps[i].cut;
}

function updateStep() {
    let i = seq.selectedStep;
    let currentTrack = seq.tracks[seq.viewTrack];

    currentTrack.steps[i].note = parseInt(document.getElementById('seq-note').value);
    currentTrack.steps[i].cut = parseInt(document.getElementById('seq-cut').value);

    const stepEl = document.getElementById('step-' + i);
    if (currentTrack.steps[i].cut > 0) stepEl.classList.add('has-lock');
    else stepEl.classList.remove('has-lock');
}

function clearSeq() {
    seq.tracks.forEach(track => {
        track.steps.forEach(s => { s.active = false; s.cut = 0; s.note = 60; });
    });
    // Force a visual redraw of the current track
    selectSeqTrack(seq.viewTrack);
}

// --- 2. INTERACTION LOGIC ---
function update(id, fromMidi = false) {
    const v = document.getElementById(id).value;
    const out = document.getElementById('v-' + id);

    // 1. Text Update
    if (id === 'egm') {
        const a = Math.round(((12 - v) / 11) * 100);
        out.innerText = `${a}/${100 - a}`;
    } else {
        out.innerText = LABELS[id] ? LABELS[id][v] : v;
    }

    // 2. Ghost Target Match Check
    const g = document.getElementById('g-' + id);
    if (g) {
        const t = g.getAttribute('data-target');
        g.style.background = (t && v == t) ? "var(--match-green)" : "var(--target-blue)";
    }

    // 3. Output MIDI (Only if user moved the slider on screen, NOT if the hardware synth moved it)
    if (!fromMidi && midiOut) {
        let ccNum = Object.keys(ccMap).find(k => ccMap[k] === id);
        if (ccNum) {
            const el = document.getElementById(id);
            let midiVal = Math.round(((v - el.min) / (el.max - el.min)) * 127);
            if (id === 'efft') midiVal = 127 - midiVal; // Handle Effect inversion
            midiOut.send([0xB0, parseInt(ccNum), midiVal]);
        }
    }
}

function learn(id) { isLearning = id; document.getElementById('midi-status').innerText = "LEARNING " + id + "..."; }

// Modulators & Toggles
function toggleArp() { arp.on = !arp.on; const b = document.getElementById('btn-arp'); b.innerText = arp.on ? "ARP: ON" : "ARP: OFF"; b.classList.toggle('active'); if (!arp.on && midiOut) midiOut.send([0xB0, 123, 0]); arp.held = []; arp.notes = []; }
function toggleLatch() { arp.latch = !arp.latch; const b = document.getElementById('btn-latch'); b.innerText = arp.latch ? "LATCH: ON" : "LATCH: OFF"; b.classList.toggle('active'); }
function updateBpm(v) { document.getElementById('bpm-val').innerText = v; }
function toggleLFO2() { mod.lfo2On = !mod.lfo2On; const b = document.getElementById('btn-lfo2'); b.innerText = mod.lfo2On ? "LFO 2: ON" : "LFO 2: OFF"; b.classList.toggle('active'); }
function toggleVel() { mod.velOn = !mod.velOn; const b = document.getElementById('btn-vel'); b.innerText = mod.velOn ? "VEL TO FILTER: ON" : "VEL TO FILTER: OFF"; b.classList.toggle('active'); }

// --- FX TOGGLES ---
function toggleDelay() {
    // SAFETY GUARD: Don't run if sensors aren't initialized
    if (!micSource) {
        alert("Please click INIT SENSORS first!");
        return;
    }

    fxState.delay = !fxState.delay;
    const b = document.getElementById('btn-delay');
    b.innerText = fxState.delay ? "DELAY: ON" : "DELAY: OFF";
    b.classList.toggle('active');
    buildFXRouting();
}

function toggleReverb() {
    // SAFETY GUARD: Don't run if sensors aren't initialized
    if (!micSource) {
        alert("Please click INIT SENSORS first!");
        return;
    }

    fxState.verb = !fxState.verb;
    const b = document.getElementById('btn-verb');
    b.innerText = fxState.verb ? "REVERB: ON" : "REVERB: OFF";
    b.classList.toggle('active');
    buildFXRouting();
}

// --- MASTER RECORDER LOGIC ---
function toggleMasterRecord() {
    const btn = document.getElementById('master-rec-btn');

    if (mediaRecorder && mediaRecorder.state === "recording") {
        // Stop Recording
        mediaRecorder.stop();
        btn.innerText = "⏺️ REC AUDIO";
        btn.classList.remove('recording');
    } else {
        // Start Recording
        if (!audioDestNode) { alert("Click INIT SENSORS first!"); return; }

        recordedChunks = [];
        mediaRecorder = new MediaRecorder(audioDestNode.stream);

        mediaRecorder.ondataavailable = function (e) {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };

        mediaRecorder.onstop = function () {
            // Package into an audio file and force download!
            const blob = new Blob(recordedChunks, { type: 'audio/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            document.body.appendChild(a);
            a.style = 'display: none';
            a.href = url;
            a.download = 'Reface_CS_Master_Take.webm';
            a.click();
            window.URL.revokeObjectURL(url);
        };

        mediaRecorder.start();
        btn.innerText = "⏹️ STOP & SAVE";
        btn.classList.add('recording');
    }
}

// --- TURING MACHINE UI ---
function toggleTuring() {
    turing.on = !turing.on;
    const b = document.getElementById('btn-turing');
    b.innerText = turing.on ? "TURING: ON" : "TURING: OFF";
    b.classList.toggle('active');

    // Auto-seed a melody if the sequence is empty/default
    if (turing.on && turing.sequence[0] === 60) seedTuring();

    if (!turing.on) {
        turing.currentStep = -1;
        updateTuringVis();
    }
}

function updateTuringMut(val) {
    turing.mutation = parseInt(val);
    document.getElementById('turing-mut-val').innerText = val + "%";
}

function updateTuringLen(val) {
    turing.length = parseInt(val);
    document.getElementById('turing-len-val').innerText = val;
    updateTuringVis();
}

function seedTuring() {
    for (let i = 0; i < 16; i++) {
        turing.sequence[i] = generateScaleNote();
    }
    updateTuringVis();
}

function updateTuringVis() {
    const vis = document.getElementById('turing-vis');
    if (!vis) return;
    vis.innerHTML = ''; // Clear old bars

    for (let i = 0; i < turing.length; i++) {
        const bar = document.createElement('div');
        bar.className = 'turing-bar';

        // Calculate height based on pitch (MIDI 48 to 84 is a 3-octave span)
        const heightPct = Math.max(10, Math.min(100, ((turing.sequence[i] - 48) / 36) * 100));
        bar.style.height = `${heightPct}%`;

        // Highlight the playhead, and turn it Blue if it mutated!
        if (i === turing.currentStep && turing.on) {
            bar.classList.add(turing.mutatedThisStep ? 'mutated' : 'active');
        }

        vis.appendChild(bar);
    }
}

// Draw the default state on load
updateTuringVis();

// --- XY PAD LOGIC ---
function assignXY(corner) {
    // Save current slider state to this corner
    let patchData = {};
    CONFIG.forEach(s => s.controls.forEach(c => {
        patchData[c.id] = document.getElementById(c.id).value;
    }));
    xyState[corner] = patchData;

    // Change the button color to green so you know it's loaded!
    const btn = event.target;
    btn.style.background = "var(--match-green)";
    btn.style.color = "black";
    btn.innerText = `CORNER ${corner} LOADED`;
}

// Mouse Drag Events for the Pad
const pad = document.getElementById('xy-pad');
const puck = document.getElementById('xy-puck');

pad.addEventListener('mousedown', (e) => { xyState.isDragging = true; movePuck(e); });
window.addEventListener('mouseup', () => { xyState.isDragging = false; });
window.addEventListener('mousemove', (e) => {
    if (xyState.isDragging) movePuck(e);
});

function movePuck(e) {
    const rect = pad.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    // Clamp to box boundaries
    x = Math.max(0, Math.min(x, rect.width));
    y = Math.max(0, Math.min(y, rect.height));

    // Move the visual dot
    puck.style.left = `${x}px`;
    puck.style.top = `${y}px`;

    // Normalize to 0.0 - 1.0 for math
    const normX = x / rect.width;
    const normY = y / rect.height;

    // Fire the Morph! (Only if all 4 corners have sounds assigned)
    if (xyState.A && xyState.B && xyState.C && xyState.D) {
        calculateXYMorph(normX, normY);
    }
}


// Looper Controls
function toggleRec(t) {
    let trk = looper.tracks[t]; let btn = document.getElementById('rec-btn-' + t); trk.rec = !trk.rec;
    if (trk.rec) {
        btn.innerText = "RECORDING"; btn.className = "btn-rec recording";
        if (looper.loopLength > 0) trk.events = [];
    } else {
        btn.innerText = "PLAYING"; btn.className = "btn-rec has-data";
        if (looper.loopLength === 0 && trk.events.length > 0) looper.loopLength = looper.time;
    }
}
function clearTrack(t) { looper.tracks[t].events = []; looper.tracks[t].rec = false; let btn = document.getElementById('rec-btn-' + t); btn.innerText = "RECORD"; btn.className = "btn-rec"; if (midiOut) midiOut.send([0xB0, 123, 0]); }

// --- 3. PRESET LIBRARY ---
function randomize() { CONFIG.forEach(s => s.controls.forEach(c => { const r = Math.floor(Math.random() * (c.max - c.min + 1)) + c.min; const g = document.getElementById('g-' + c.id); const t = document.getElementById('t-' + c.id); g.style.bottom = ((r - c.min) / (c.max - c.min) * 126) + "px"; g.style.display = "block"; g.setAttribute('data-target', r); t.innerText = "🎯" + (LABELS[c.id] ? LABELS[c.id][r] : r); t.style.display = "block"; if (document.getElementById(c.id).value == r) g.style.background = "var(--match-green)"; else g.style.background = "var(--target-blue)"; })); }
function hideGhost() { CONFIG.forEach(s => s.controls.forEach(c => { document.getElementById('g-' + c.id).style.display = "none"; document.getElementById('t-' + c.id).style.display = "none"; })); }
function savePatch() { const p = { name: document.getElementById('pName').value || "Patch", notes: document.getElementById('pNotes').value, data: {} }; CONFIG.forEach(s => s.controls.forEach(c => p.data[c.id] = document.getElementById(c.id).value)); const lib = JSON.parse(localStorage.getItem('ref_lib_omnibus')) || []; lib.push(p); localStorage.setItem('ref_lib_omnibus', JSON.stringify(lib)); render(); }
function render() { const list = document.getElementById('pList'); const lib = JSON.parse(localStorage.getItem('ref_lib_omnibus')) || []; list.innerHTML = lib.map((p, i) => `<div class="patch-card" onclick="load(${i})"><h4>${p.name}</h4><p>${p.notes}</p><div class="del-x" onclick="del(${i},event)">×</div></div>`).join(''); }
function load(i) {
    const p = JSON.parse(localStorage.getItem('ref_lib_omnibus'))[i];
    document.getElementById('pName').value = p.name;
    document.getElementById('pNotes').value = p.notes;

    // Instead of forcing the sliders to move, we draw the Ghost Targets!
    CONFIG.forEach(s => s.controls.forEach(c => {
        if (p.data[c.id] !== undefined) {
            const targetVal = parseInt(p.data[c.id]);
            const g = document.getElementById('g-' + c.id);
            const t = document.getElementById('t-' + c.id);

            // Position the Ghost Marker on the slider track
            g.style.bottom = ((targetVal - c.min) / (c.max - c.min) * 126) + "px";
            g.style.display = "block";
            g.setAttribute('data-target', targetVal);

            // Set the target text popup
            t.innerText = "🎯" + (LABELS[c.id] ? LABELS[c.id][targetVal] : targetVal);
            t.style.display = "block";

            // Check if your physical slider already matches the target
            if (document.getElementById(c.id).value == targetVal) {
                g.style.background = "var(--match-green)";
            } else {
                g.style.background = "var(--target-blue)";
            }
        }
    }));
}
function del(i, e) { e.stopPropagation(); const lib = JSON.parse(localStorage.getItem('ref_lib_omnibus')); lib.splice(i, 1); localStorage.setItem('ref_lib_omnibus', JSON.stringify(lib)); render(); }
function exportLibrary() { const b = new Blob([localStorage.getItem('ref_lib_omnibus')], { type: "application/json" }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = "Reface_Library.json"; a.click(); }
function importLibrary(e) { const r = new FileReader(); r.onload = (ev) => { localStorage.setItem('ref_lib_omnibus', ev.target.result); render(); }; r.readAsText(e.target.files[0]); }
function exportMapping() { const b = new Blob([JSON.stringify(ccMap)], { type: "application/json" }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = "Reface_Mapping.json"; a.click(); }
function importMapping(e) { const r = new FileReader(); r.onload = (ev) => { ccMap = JSON.parse(ev.target.result); localStorage.setItem('ref_cc_omnibus', JSON.stringify(ccMap)); location.reload(); }; r.readAsText(e.target.files[0]); }

// --- 4. BOOT UP THE APP ---
render();
updateBreederUI();
CONFIG.forEach(s => s.controls.forEach(c => update(c.id)));
drawCoF();
draw();

// --- DRAWABLE LFO UI ---
const drawCanvas = document.getElementById('draw-lfo-canvas');
const drawCtx = drawCanvas.getContext('2d');

// Ensure canvas matches its CSS size
drawCanvas.width = drawCanvas.clientWidth;
drawCanvas.height = drawCanvas.clientHeight;

function toggleDrawLFO() {
    drawLfo.on = !drawLfo.on;
    const b = document.getElementById('btn-draw-lfo');
    b.innerText = drawLfo.on ? "LFO: ON" : "LFO: OFF";
    b.classList.toggle('active');

    // THE FIX: Reset the synth when the LFO turns off!
    if (!drawLfo.on && midiOut) {
        // We force the synth to read the current UI sliders to "wake it up"
        ['fcut', 'fres', 'lfod'].forEach(id => {
            let ccNum = Object.keys(ccMap).find(k => ccMap[k] === id);
            if (ccNum) {
                let val = document.getElementById(id).value;
                let el = document.getElementById(id);
                let midiVal = Math.round(((val - el.min) / (el.max - el.min)) * 127);
                midiOut.send([0xB0, parseInt(ccNum), midiVal]);
            }
        });
    }
}

function renderDrawLfo() {
    const w = drawCanvas.width;
    const h = drawCanvas.height;
    drawCtx.clearRect(0, 0, w, h);

    // 1. Draw the glowing waveform path
    drawCtx.beginPath();
    drawCtx.strokeStyle = 'var(--target-blue)';
    drawCtx.lineWidth = 3;
    drawCtx.shadowBlur = 10;
    drawCtx.shadowColor = 'var(--target-blue)';

    const sliceWidth = w / (drawLfo.resolution - 1);
    for (let i = 0; i < drawLfo.resolution; i++) {
        const x = i * sliceWidth;
        const y = (1 - drawLfo.path[i]) * h; // Invert so 1.0 is at the top!
        if (i === 0) drawCtx.moveTo(x, y);
        else drawCtx.lineTo(x, y);
    }
    drawCtx.stroke();
    drawCtx.shadowBlur = 0;

    // 2. Draw the moving Playhead
    if (drawLfo.on) {
        const playX = drawLfo.phase * w;
        drawCtx.beginPath();
        drawCtx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        drawCtx.lineWidth = 2;
        drawCtx.moveTo(playX, 0);
        drawCtx.lineTo(playX, h);
        drawCtx.stroke();
    }
}

// Mouse Drag / "Painting" Logic
function handleDrawing(e) {
    if (!drawLfo.isDrawing) return;

    const rect = drawCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Map mouse X to the nearest array index (0-99)
    let index = Math.floor((x / rect.width) * drawLfo.resolution);
    index = Math.max(0, Math.min(drawLfo.resolution - 1, index));

    // Map mouse Y to 0.0 - 1.0
    let val = 1 - (y / rect.height);
    val = Math.max(0, Math.min(1, val));

    // GAP FILLER: If the mouse moved too fast, draw a line between the last point and this point
    if (drawLfo.lastDrawIndex !== -1 && Math.abs(index - drawLfo.lastDrawIndex) > 1) {
        const startIdx = Math.min(index, drawLfo.lastDrawIndex);
        const endIdx = Math.max(index, drawLfo.lastDrawIndex);
        const startVal = index === startIdx ? val : drawLfo.path[drawLfo.lastDrawIndex];
        const endVal = index === endIdx ? val : drawLfo.path[drawLfo.lastDrawIndex];

        for (let i = startIdx + 1; i < endIdx; i++) {
            const ratio = (i - startIdx) / (endIdx - startIdx);
            drawLfo.path[i] = startVal + (endVal - startVal) * ratio;
        }
    }

    drawLfo.path[index] = val;
    drawLfo.lastDrawIndex = index;
    renderDrawLfo(); // Force UI update
}

// Mouse Listeners
drawCanvas.addEventListener('mousedown', (e) => {
    drawLfo.isDrawing = true;
    handleDrawing(e);
});
window.addEventListener('mouseup', () => {
    drawLfo.isDrawing = false;
    drawLfo.lastDrawIndex = -1; // Reset gap filler
});
drawCanvas.addEventListener('mousemove', handleDrawing);

// --- AUTO-SAMPLER ROBOT LOGIC ---
async function startAutoSampler() {
    if (!midiOut) { alert("MIDI not connected!"); return; }
    if (!audioDestNode) { alert("Please click INIT SENSORS first!"); return; }

    const btn = document.getElementById('btn-autosample');
    const status = document.getElementById('sampler-status');

    // Lock the button so you don't click it twice
    btn.disabled = true;
    btn.style.background = "#444";

    // 1. Setup the Audio Recorder
    let samplerChunks = [];
    const samplerRecorder = new MediaRecorder(audioDestNode.stream);
    samplerRecorder.ondataavailable = e => { if (e.data.size > 0) samplerChunks.push(e.data); };

    // 2. Define what happens when the robot finishes
    samplerRecorder.onstop = () => {
        const blob = new Blob(samplerChunks, { type: 'audio/webm' }); // Creates the audio file
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style = 'display: none';
        a.href = url;
        a.download = 'Reface_CS_Sample_Pack.webm'; // Names the file
        document.body.appendChild(a);
        a.click(); // Forces the download
        window.URL.revokeObjectURL(url);

        status.innerText = "✅ SAMPLING COMPLETE!";
        btn.disabled = false;
        btn.style.background = "var(--target-blue)";
        setTimeout(() => status.innerText = "", 4000);
    };

    // 3. Start Recording Audio
    samplerRecorder.start();

    // 4. The Notes we want the robot to play: C2, C3, C4, C5 
    // (MIDI values 36, 48, 60, 72)
    const notesToSample = [36, 48, 60, 72];
    const noteNames = ["C2", "C3", "C4", "C5"];

    // A tiny helper function to make the code wait in real-time
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    // Give it a second of silence at the very beginning
    status.innerText = "⏱️ PREPARING...";
    await sleep(1000);

    // 5. The Robot Loop
    for (let i = 0; i < notesToSample.length; i++) {
        let note = notesToSample[i];

        // Push the key down
        status.innerText = `🔴 RECORDING: ${noteNames[i]}...`;
        midiOut.send([0x90, note, 100]);

        // Hold the key for 1.5 seconds
        await sleep(1500);

        // Let go of the key
        midiOut.send([0x80, note, 0]);

        // Wait 2 full seconds for the release/reverb tail to fade to silence
        status.innerText = `⏳ CAPTURING TAIL: ${noteNames[i]}...`;
        await sleep(2000);
    }

    // 6. Finish up
    status.innerText = "💾 SAVING FILE TO COMPUTER...";
    await sleep(500); // Give the recorder a tiny buffer to catch the last millisecond
    samplerRecorder.stop();
}

// --- SIDECHAIN UI LOGIC ---
function toggleSidechain() {
    if (!analyser) {
        alert("Please click INIT SENSORS first so the mic can listen!");
        return;
    }

    sidechain.on = !sidechain.on;
    const b = document.getElementById('btn-sidechain');
    b.innerText = sidechain.on ? "SIDECHAIN: ON" : "SIDECHAIN: OFF";
    b.classList.toggle('active');

    // Safety Net: Reset the synth values to normal when turning off!
    if (!sidechain.on && midiOut) {
        // Reset Expression Volume to 100%
        midiOut.send([0xB0, 11, 127]);

        // Reset Filter Cutoff to physical slider position
        let fcutVal = document.getElementById('fcut').value;
        let ccBase = Math.round(((fcutVal - 1) / 11) * 127);
        midiOut.send([0xB0, 74, ccBase]);

        // Clear the visual meter
        document.getElementById('sc-fill').style.width = '0%';
    }
}

function updateSidechainMeter(level, thresh) {
    const fill = document.getElementById('sc-fill');
    if (!fill) return;

    fill.style.width = (level * 100) + '%';

    // Turn the bar neon green if it crosses the threshold and starts pumping!
    if (level > thresh) fill.classList.add('active');
    else fill.classList.remove('active');
}

// --- VOCAL CONTROLLER UI ---
function toggleVocal() {
    if (!analyser) {
        alert("Please click INIT SENSORS first so the mic can listen!");
        return;
    }

    vocalCtrl.on = !vocalCtrl.on;
    const b = document.getElementById('btn-vocal');
    b.innerText = vocalCtrl.on ? "MIC DETECT: ON" : "MIC DETECT: OFF";
    b.classList.toggle('active');

    // Safety Net: Kill any stuck notes when you turn it off
    if (!vocalCtrl.on) {
        if (vocalCtrl.activeNote !== -1 && midiOut) {
            midiOut.send([0x80, vocalCtrl.activeNote, 0]);
        }
        vocalCtrl.activeNote = -1;
        updateVocalUI(-1);
    }
}

function updateVocalUI(midiNote) {
    const display = document.getElementById('vocal-note-out');
    if (midiNote === -1) {
        display.innerText = "--";
        display.classList.remove('vocal-active');
    } else {
        // Convert MIDI note number to Note Name (e.g., 60 -> C)
        display.innerText = noteNames[midiNote % 12];
        display.classList.add('vocal-active');
    }
}

// --- WEBCAM THEREMIN UI & AI SETUP ---
const thVideo = document.getElementById('theremin-video');
const thCanvas = document.getElementById('theremin-canvas');
const thCtx = thCanvas ? thCanvas.getContext('2d') : null;

async function initThereminAI() {
    if (theremin.handsAI) return; // Already initialized

    document.getElementById('theremin-status').innerText = "LOADING AI...";

    // 1. Load the Google MediaPipe Hands Model
    theremin.handsAI = new Hands({
        locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
    });

    theremin.handsAI.setOptions({
        maxNumHands: 2,
        modelComplexity: 0, // 0 is fastest, perfectly fine for this
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });

    // 2. Tell the AI where to send the data once it finds hands
    theremin.handsAI.onResults(processThereminHands);

    // 3. Setup the Camera feed
    theremin.camera = new Camera(thVideo, {
        onFrame: async () => {
            if (theremin.on) await theremin.handsAI.send({ image: thVideo });
        },
        width: 320,
        height: 240
    });

    document.getElementById('theremin-status').innerText = "AI READY";
}

function toggleTheremin() {
    theremin.on = !theremin.on;
    const b = document.getElementById('btn-theremin');
    b.innerText = theremin.on ? "THEREMIN: ON" : "THEREMIN: OFF";
    b.classList.toggle('active');

    if (theremin.on) {
        if (!theremin.handsAI) initThereminAI();
        if (theremin.camera) theremin.camera.start();
        document.getElementById('theremin-status').innerText = "CAMERA ON";
    } else {
        if (theremin.camera) theremin.camera.stop();
        thCtx.clearRect(0, 0, thCanvas.width, thCanvas.height);
        document.getElementById('theremin-status').innerText = "CAMERA OFF";
    }
}

// --- SYNTH DRONE LOGIC ---
let isDroning = false;
function toggleDrone() {
    isDroning = !isDroning;
    const b = document.getElementById('btn-drone');
    b.innerText = isDroning ? "DRONE: ON" : "DRONE: OFF";
    b.classList.toggle('active');

    if (midiOut) {
        if (isDroning) {
            midiOut.send([0x90, 36, 100]); // Tells the synth to hold a Low C2 note forever
        } else {
            midiOut.send([0xB0, 123, 0]); // MIDI Panic: Tells the synth to release all notes
        }
    }
}

// --- EUCLIDEAN POLYRHYTHM ENGINE ---
function applyEuclidean() {
    const trackIdx = parseInt(document.getElementById('euc-track').value);
    const steps = parseInt(document.getElementById('euc-steps').value);
    const hits = Math.min(parseInt(document.getElementById('euc-hits').value), steps);
    const useMelody = document.getElementById('euc-rand-notes').checked;

    let track = seq.tracks[trackIdx];

    // 1. Wipe the target track completely clean
    track.steps.forEach(s => { s.active = false; s.cut = 0; });

    // 2. Distribute hits, and optionally assign random scale notes!
    for (let i = 0; i < steps; i++) {
        if ((i * hits) % steps < hits) {
            track.steps[i].active = true;

            if (useMelody && typeof generateScaleNote === "function") {
                // Generate a random note from the selected musical scale!
                track.steps[i].note = generateScaleNote();
            } else {
                track.steps[i].note = 60; // Default Middle C
            }
        }
    }

    if (seq.viewTrack === trackIdx) selectSeqTrack(trackIdx);
}

// --- CELLULAR AUTOMATA UI & BIOLOGY ---
const lifeGridEl = document.getElementById('life-grid');
if (lifeGridEl) {
    // Generate the 128 clickable HTML squares
    for (let r = 0; r < life.height; r++) {
        for (let c = 0; c < life.width; c++) {
            let cell = document.createElement('div');
            cell.className = 'life-cell';
            cell.id = `life-${r}-${c}`;

            // Clicking toggles the cell's life
            cell.onclick = () => {
                life.grid[r][c] = !life.grid[r][c];
                cell.classList.toggle('alive', life.grid[r][c]);
            };
            lifeGridEl.appendChild(cell);
        }
    }
}

function toggleLife() {
    life.on = !life.on;
    const b = document.getElementById('btn-life');
    b.innerText = life.on ? "LIFE: ON" : "LIFE: OFF";
    b.classList.toggle('active');

    if (!life.on) {
        life.currentStep = -1;
        document.querySelectorAll('.life-cell').forEach(el => el.classList.remove('playing'));
    }
}

function clearLife() {
    for (let r = 0; r < life.height; r++) {
        for (let c = 0; c < life.width; c++) {
            life.grid[r][c] = false;
            document.getElementById(`life-${r}-${c}`).classList.remove('alive');
        }
    }
}

function randomizeLife() {
    for (let r = 0; r < life.height; r++) {
        for (let c = 0; c < life.width; c++) {
            life.grid[r][c] = Math.random() > 0.75; // 25% chance of spawning
            document.getElementById(`life-${r}-${c}`).classList.toggle('alive', life.grid[r][c]);
        }
    }
}

function evolveLife() {
    // Create a blank slate for the next generation
    let newGrid = Array.from({ length: life.height }, () => Array(life.width).fill(false));

    for (let r = 0; r < life.height; r++) {
        for (let c = 0; c < life.width; c++) {
            let aliveNeighbors = 0;

            // Check the 8 surrounding neighbors
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue; // Don't count yourself

                    let nr = r + dr;
                    let nc = c + dc;

                    // Wrap around the edges (so shapes can fly off the right edge and appear on the left)
                    if (nr < 0) nr = life.height - 1;
                    if (nr >= life.height) nr = 0;
                    if (nc < 0) nc = life.width - 1;
                    if (nc >= life.width) nc = 0;

                    if (life.grid[nr][nc]) aliveNeighbors++;
                }
            }

            let isAlive = life.grid[r][c];

            // CONWAY'S RULES OF LIFE
            if (isAlive && (aliveNeighbors === 2 || aliveNeighbors === 3)) {
                newGrid[r][c] = true; // Survival
            } else if (!isAlive && aliveNeighbors === 3) {
                newGrid[r][c] = true; // Reproduction
            } else {
                newGrid[r][c] = false; // Death (under/over-population)
            }
        }
    }

    life.grid = newGrid;

    // Visually update the UI to match the new biology
    for (let r = 0; r < life.height; r++) {
        for (let c = 0; c < life.width; c++) {
            document.getElementById(`life-${r}-${c}`).classList.toggle('alive', life.grid[r][c]);
        }
    }
}

// --- 3D BINAURAL SPATIALIZER UI ---
const radarScreen = document.getElementById('radar-screen');
const radarPuck = document.getElementById('radar-puck');

function toggle3D() {
    if (!spatializer.panner) { alert("Please click INIT SENSORS first!"); return; }

    spatializer.on = !spatializer.on;
    const b = document.getElementById('btn-3d');
    b.innerText = spatializer.on ? "3D AUDIO: ON" : "3D AUDIO: OFF";
    b.classList.toggle('active');

    // If turned off, snap the audio back to the center of your head
    if (!spatializer.on) {
        // We use setTargetAtTime to smoothly glide the audio back, preventing pops/clicks!
        spatializer.panner.positionX.setTargetAtTime(0, audioCtx.currentTime, 0.1);
        spatializer.panner.positionZ.setTargetAtTime(0, audioCtx.currentTime, 0.1);
        spatializer.panner.positionY.setTargetAtTime(0, audioCtx.currentTime, 0.1);

        radarPuck.style.left = '50%';
        radarPuck.style.top = '50%';
        document.getElementById('radar-elev').value = 0;
    }
}

function updateElevation(val) {
    if (spatializer.on && spatializer.panner) {
        // Y-Axis is up/down in Web Audio
        spatializer.panner.positionY.setTargetAtTime(parseFloat(val), audioCtx.currentTime, 0.1);
    }
}

// Mouse Listeners for the Radar
if (radarScreen) {
    radarScreen.addEventListener('mousedown', (e) => { spatializer.isDragging = true; moveRadar(e); });
    window.addEventListener('mouseup', () => { spatializer.isDragging = false; });
    window.addEventListener('mousemove', (e) => { if (spatializer.isDragging) moveRadar(e); });
}

function moveRadar(e) {
    if (!spatializer.on || !spatializer.panner) return;

    const rect = radarScreen.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    // Clamp puck inside the box
    x = Math.max(0, Math.min(x, rect.width));
    y = Math.max(0, Math.min(y, rect.height));

    radarPuck.style.left = `${x}px`;
    radarPuck.style.top = `${y}px`;

    // Convert pixels (0 to 150) to 3D Space coordinates (-10 to +10)
    const mapX = ((x / rect.width) * 20) - 10;

    // Z is depth. In Web Audio, Negative Z is in FRONT of you, Positive Z is BEHIND you.
    const mapZ = ((y / rect.height) * 20) - 10;

    // Smoothly sweep the audio to the new 3D location
    spatializer.panner.positionX.setTargetAtTime(mapX, audioCtx.currentTime, 0.05);
    spatializer.panner.positionZ.setTargetAtTime(mapZ, audioCtx.currentTime, 0.05);
}

// --- 3D AUTO-ORBIT UI ---
function toggleOrbit() {
    spatializer.autoOrbit = !spatializer.autoOrbit;
    const b = document.getElementById('btn-orbit');
    b.innerText = spatializer.autoOrbit ? "AUTO ORBIT: ON" : "AUTO ORBIT: OFF";
    b.classList.toggle('active');
}

function updateRadarUI(mapX, mapZ) {
    const radarPuck = document.getElementById('radar-puck');
    if (!radarPuck) return;

    // The math to convert the 3D space (-10 to +10) back into browser pixels (0% to 100%)
    const pctX = ((mapX + 10) / 20) * 100;
    const pctZ = ((mapZ + 10) / 20) * 100;

    radarPuck.style.left = `${pctX}%`;
    radarPuck.style.top = `${pctZ}%`;
}

// --- GENETIC PATCH BREEDER ALGORITHM ---

// 1. Fills the Mother/Father dropdowns with your saved presets
function updateBreederUI() {
    const lib = JSON.parse(localStorage.getItem('ref_lib_omnibus') || '[]');
    const momSel = document.getElementById('breed-mom');
    const dadSel = document.getElementById('breed-dad');

    if (!momSel || !dadSel) return;

    momSel.innerHTML = '';
    dadSel.innerHTML = '';

    lib.forEach((p, i) => {
        let opt1 = document.createElement('option'); opt1.value = i; opt1.text = p.name;
        let opt2 = document.createElement('option'); opt2.value = i; opt2.text = p.name;
        momSel.appendChild(opt1);
        dadSel.appendChild(opt2);
    });

    // Auto-select the second patch as the Father if you have at least 2 saved
    if (lib.length > 1) dadSel.selectedIndex = 1;
}

// 2. The Genetic Engine
function breedPatches() {
    let lib = JSON.parse(localStorage.getItem('ref_lib_omnibus') || '[]');
    if (lib.length < 2) {
        alert("You need at least 2 saved patches in your Library to breed!");
        return;
    }

    const momIdx = document.getElementById('breed-mom').value;
    const dadIdx = document.getElementById('breed-dad').value;
    const mutRate = parseInt(document.getElementById('breed-mut').value);

    const mom = lib[momIdx];
    const dad = lib[dadIdx];

    // We are going to give birth to 4 offspring patches!
    for (let c = 1; c <= 4; c++) {
        let childData = {};

        // Find every single slider that the parents use
        let allKeys = new Set([...Object.keys(mom.data), ...Object.keys(dad.data)]);

        allKeys.forEach(key => {
            // CROSSOVER: 50% chance to inherit the Mother's slider, 50% chance for the Father's
            let val = (Math.random() > 0.5) ? mom.data[key] : dad.data[key];

            // Fallback just in case one parent doesn't have that specific slider saved
            if (val === undefined) val = mom.data[key] || dad.data[key];

            // MUTATION: A random chance that the DNA gets corrupted during splicing!
            if (Math.random() * 100 < mutRate) {
                // Mutate the slider by pushing it up or down by a random amount (-15 to +15)
                let mutationAmt = Math.floor(Math.random() * 31) - 15;
                val = Math.max(0, Math.min(127, parseInt(val) + mutationAmt)); // Clamp between 0 and 127
            }

            childData[key] = val;
        });

        // Save the newborn patch
        let childPatch = {
            name: `Mutant ${c} (${mom.name.substring(0, 3)}x${dad.name.substring(0, 3)})`,
            notes: `Genetically bred. Mutation rate: ${mutRate}%`,
            data: childData
        };

        lib.push(childPatch); // Add to library array
    }

    // Save the updated library back to the browser memory
    localStorage.setItem('ref_lib_omnibus', JSON.stringify(lib));

    // Refresh the UI menus
    if (typeof render === "function") render();
    updateBreederUI();

    // Summon the Ghost Markers for the very first child so you can instantly hear it!
    if (typeof load === "function") load(lib.length - 4);
}

// --- GHOST MOTION UI LOGIC ---
function toggleMotionRec() {
    motionSeq.isRecording = !motionSeq.isRecording;
    const b = document.getElementById('btn-motion-rec');

    if (motionSeq.isRecording) {
        b.innerText = "🔴 RECORDING...";
        b.style.background = "red";
        b.style.color = "white";
        // If we aren't already playing, start the master clock!
        if (!motionSeq.isPlaying) {
            motionSeq.playStart = performance.now();
            motionSeq.isPlaying = true;
            document.getElementById('btn-motion-play').innerText = "⏹️ STOP GHOST";
            document.getElementById('btn-motion-play').classList.add('active');
        }
    } else {
        b.innerText = "🔴 ARM RECORD";
        b.style.background = "transparent";
        b.style.color = "red";
    }
}

function toggleMotionPlay() {
    motionSeq.isPlaying = !motionSeq.isPlaying;
    const b = document.getElementById('btn-motion-play');
    b.innerText = motionSeq.isPlaying ? "⏹️ STOP GHOST" : "▶️ PLAY GHOST";
    b.classList.toggle('active');

    if (motionSeq.isPlaying) {
        motionSeq.playStart = performance.now();
        motionSeq.lastTickPct = 0;
    } else {
        motionSeq.isRecording = false; // Safety stop recording
        document.getElementById('btn-motion-rec').innerText = "🔴 ARM RECORD";
        document.getElementById('btn-motion-rec').style.background = "transparent";
        document.getElementById('btn-motion-rec').style.color = "red";
        document.getElementById('motion-playhead').style.width = '0%';
    }
}

function clearMotion() {
    motionSeq.events = [];
    // Give the button a flash to show it worked
    const btn = event.target;
    btn.innerText = "✅ CLEARED!";
    setTimeout(() => btn.innerText = "🗑️ WIPE AUTOMATION MEMORY", 1000);
}

// --- GRAVITY SEQUENCER UI & MIDI ---
const gravCvs = document.getElementById('grav-canvas');

// Mouse dragging logic to draw walls
if (gravCvs) {
    gravCvs.addEventListener('mousedown', e => {
        const rect = gravCvs.getBoundingClientRect();
        grav.startX = e.clientX - rect.left;
        grav.startY = e.clientY - rect.top;
        grav.tempX = grav.startX; grav.tempY = grav.startY;
        grav.isDrawing = true;
    });

    window.addEventListener('mousemove', e => {
        if (!grav.isDrawing) return;
        const rect = gravCvs.getBoundingClientRect();
        grav.tempX = e.clientX - rect.left;
        grav.tempY = e.clientY - rect.top;
    });

    window.addEventListener('mouseup', e => {
        if (!grav.isDrawing) return;
        grav.isDrawing = false;
        // Save the line to the physics engine!
        grav.lines.push({ x1: grav.startX, y1: grav.startY, x2: grav.tempX, y2: grav.tempY });
    });
}

function spawnGravBall() {
    // Drop a ball near the top center with a slight random horizontal push
    grav.balls.push({
        x: 150 + (Math.random() * 20 - 10),
        y: 10,
        vx: (Math.random() - 0.5) * 4,
        vy: 0,
        r: 6
    });
}

function clearGrav() {
    grav.lines = [];
    grav.balls = [];
}

// Translate Physics into Music!
function triggerGravNote(xPos, canvasWidth, speed) {
    if (!midiOut) return;

    // 1. Ask the Theory Engine what scale we are in
    let sRoot = parseInt(document.getElementById('scale-root').value) || 0;
    let sType = document.getElementById('scale-type').value;
    let intervals = scaleDict[sType] || scaleDict['Major'];

    // 2. Map the X-coordinate (0 to 300px) across a 16-note spread
    let numNotes = 16;
    let noteIndex = Math.floor((xPos / canvasWidth) * numNotes);
    noteIndex = Math.max(0, Math.min(numNotes - 1, noteIndex));

    let octaveOffset = Math.floor(noteIndex / intervals.length);
    let intervalIdx = noteIndex % intervals.length;

    let baseMidi = 48; // Base octave (C3)
    let note = baseMidi + sRoot + intervals[intervalIdx] + (octaveOffset * 12);

    // 3. Map the Impact Speed to MIDI Velocity (How hard the synth is hit)
    // A fast drop creates a loud note (127), a slow roll creates a soft note (20)
    let velocity = Math.min(127, Math.max(20, Math.floor(speed * 12)));

    // Fire the note!
    midiOut.send([0x90, note, velocity]);

    // Quick Note Off (Staccato pluck)
    setTimeout(() => { if (midiOut) midiOut.send([0x80, note, 0]); }, 100);
}

// --- 80s STEREO CHORUS UI LOGIC ---
function toggleChorus() {
    if (!audioCtx) { alert("Please click INIT SENSORS first!"); return; }

    chorus.on = !chorus.on;
    const b = document.getElementById('btn-chorus');
    b.innerText = chorus.on ? "STEREO CHORUS: ON" : "STEREO CHORUS: OFF";
    b.classList.toggle('active');

    if (typeof buildFXRouting === "function") buildFXRouting();
}

function updateChorusSettings() {
    if (!chorus.lfo) return;

    const rate = document.getElementById('chorus-rate').value / 100;
    const depth = document.getElementById('chorus-depth').value / 100;
    const mix = document.getElementById('chorus-mix').value / 100;

    // Rate: 0.1Hz to 5Hz
    chorus.lfo.frequency.setTargetAtTime(0.1 + (rate * 4.9), audioCtx.currentTime, 0.1);

    // Depth: Controls how violently the delay stretches.
    // The Right channel gets the exact same depth, but mathematically INVERTED (-) to widen the stereo field!
    let depthVal = depth * 0.005;
    chorus.lfoDepthL.gain.setTargetAtTime(depthVal, audioCtx.currentTime, 0.1);
    chorus.lfoDepthR.gain.setTargetAtTime(-depthVal, audioCtx.currentTime, 0.1);

    // Dry/Wet Mix (Crossfade)
    chorus.dryGain.gain.setTargetAtTime(1.0 - mix, audioCtx.currentTime, 0.1);
    chorus.wetGain.gain.setTargetAtTime(mix, audioCtx.currentTime, 0.1);
}

// --- BITCRUSHER UI LOGIC ---
function toggleCrusher() {
    if (!audioCtx) { alert("Please click INIT SENSORS first!"); return; }

    crusher.on = !crusher.on;
    const b = document.getElementById('btn-crush');
    b.innerText = crusher.on ? "BITCRUSHER: ON" : "BITCRUSHER: OFF";

    if (crusher.on) {
        b.style.background = "#ff3366";
        b.style.color = "#fff";
    } else {
        b.style.background = "transparent";
        b.style.color = "#ff3366";
    }

    if (typeof buildFXRouting === "function") buildFXRouting();
}

function updateCrusherSettings() {
    if (!crusher.bitNode) return;

    // Drive maps from 1 to 50x multiplier
    const drive = document.getElementById('crush-drive').value / 2;
    crusher.fuzzNode.curve = makeFuzzCurve(Math.max(1, drive));

    // Bits map directly from 16 (clean CD quality) down to 1 (pure noise)
    const bits = document.getElementById('crush-bits').value;
    crusher.bitNode.curve = makeBitCurve(parseInt(bits));
}

// --- MPC BEAT REPEATER UI LOGIC ---
function triggerStutter(division) {
    if (!stutter.delayNode) { alert("Please click INIT SENSORS first!"); return; }

    // 1. Get the current BPM from your Arpeggiator input
    const bpmInput = document.getElementById('arp-bpm');
    const bpm = bpmInput ? parseFloat(bpmInput.value) : 120;

    // 2. Math to calculate loop length in seconds
    // A full measure (whole note) = (60 / BPM) * 4.
    // We divide that by the requested division (4, 8, 16, or 32).
    const delayTime = ((60 / bpm) * 4) / division;

    // 3. Snap the delay time to the exact rhythm, avoiding clicks with a tiny 0.01s glide
    stutter.delayNode.delayTime.setTargetAtTime(delayTime, audioCtx.currentTime, 0.001);

    // 4. Trap the audio! (98% feedback so it repeats continuously without blowing up your speakers)
    stutter.feedbackGain.gain.setTargetAtTime(0.98, audioCtx.currentTime, 0.01);

    // 5. Crossfade: Bring up the stuttered audio, turn down the clean audio
    stutter.wetGain.gain.setTargetAtTime(1.0, audioCtx.currentTime, 0.01);
    stutter.dryGain.gain.setTargetAtTime(0.0, audioCtx.currentTime, 0.01);
}

function releaseStutter() {
    if (!stutter.delayNode) return;

    // Instantly kill the loop and bring the clean audio back
    stutter.feedbackGain.gain.setTargetAtTime(0.0, audioCtx.currentTime, 0.01);
    stutter.wetGain.gain.setTargetAtTime(0.0, audioCtx.currentTime, 0.01);
    stutter.dryGain.gain.setTargetAtTime(1.0, audioCtx.currentTime, 0.01);
}

// --- TRANCE GATE UI LOGIC ---
const tGateGrid = document.getElementById('tgate-grid');
if (tGateGrid) {
    for (let i = 0; i < 16; i++) {
        let box = document.createElement('div');
        box.className = 'gate-step active';
        box.id = 'tgate-' + i;

        // Let's create a cool default pattern (e.g., skip every 4th 16th note)
        if ((i + 1) % 4 === 0) {
            box.classList.remove('active');
            tGate.steps[i] = false;
        }

        box.onclick = () => {
            tGate.steps[i] = !tGate.steps[i];
            box.classList.toggle('active', tGate.steps[i]);
        };
        tGateGrid.appendChild(box);
    }
}

function toggleTGate() {
    if (!audioCtx) { alert("Please click INIT SENSORS first!"); return; }

    tGate.on = !tGate.on;
    const b = document.getElementById('btn-tgate');
    b.innerText = tGate.on ? "TRANCE-GATE: ON" : "TRANCE-GATE: OFF";
    b.classList.toggle('active');

    if (typeof buildFXRouting === "function") buildFXRouting();

    // Safety: Reset volume to full and clear playhead if turned off
    if (!tGate.on) {
        if (tGate.gainNode) tGate.gainNode.gain.setTargetAtTime(1.0, audioCtx.currentTime, 0.05);
        if (tGate.currentStep >= 0) document.getElementById('tgate-' + tGate.currentStep)?.classList.remove('playing');
        tGate.currentStep = -1;
    }
}

// --- SYNTHESIA UI LOGIC ---
// --- CUSTOM MIDI LOADER ---
function loadCustomMidi(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Update the UI to show the filename
    document.getElementById('midi-filename').innerText = `Loaded: ${file.name}`;
    document.getElementById('midi-filename').style.color = "#00ffcc";

    // Read the binary file
    const reader = new FileReader();
    reader.onload = function (e) {
        // Use the Tone.js parser we added to the HTML header
        const midiData = new Midi(e.target.result);

        // A MIDI file can have many tracks (Piano, Bass, Drums). 
        // We will automatically grab the track with the most notes (usually the main melody).
        let mainTrack = midiData.tracks.reduce((prev, current) =>
            (prev.notes.length > current.notes.length) ? prev : current
        );

        if (mainTrack.notes.length === 0) {
            alert("No notes found in this MIDI file!");
            return;
        }

        // Convert the absolute time (seconds) into relative frame delays (60 FPS)
        customSong = [];
        let lastNoteTime = 0;

        mainTrack.notes.forEach(note => {
            // How many seconds since the last note was played?
            let deltaSeconds = note.time - lastNoteTime;

            // Multiply by 60 because our requestAnimationFrame runs at roughly 60 frames per second
            let delayFrames = Math.round(deltaSeconds * 60);

            customSong.push({
                pitch: note.midi,
                delay: delayFrames
            });

            lastNoteTime = note.time;
        });

        console.log(`Successfully converted ${customSong.length} notes!`);
    };

    // Trigger the file read
    reader.readAsArrayBuffer(file);
}

function startCascade() {
    // 1. Reset the board
    cascade.score = 0;
    const scoreEl = document.getElementById('cascade-score');
    if (scoreEl) scoreEl.innerText = "0000";

    cascade.fallingNotes = [];
    cascade.particles = [];

    // 2. Read the Difficulty Dropdown
    const diffEl = document.getElementById('cascade-diff');
    const diff = diffEl ? diffEl.value : "normal";

    let delayMult = 1.0; // The time multiplier between notes

    // 3. Apply the Physics & Tempo changes
    if (diff === "easy") {
        cascade.speed = 1.5; // Gravity is cut in half
        delayMult = 2.0;     // Notes wait twice as long before spawning
    } else if (diff === "hard") {
        cascade.speed = 6.0; // Gravity is doubled!
        delayMult = 0.5;     // Notes spawn twice as fast
    } else {
        cascade.speed = 3.0; // Standard Gravity
        delayMult = 1.0;     // Standard Tempo
    }

    // 4. Choose which song to play!
    let targetSong = customSong ? customSong : demoSong;

    // 5. Rebuild the song with the new tempo/difficulty applied
    let scaledSong = targetSong.map(note => ({
        pitch: note.pitch,
        delay: note.delay * delayMult
    }));

    // If it's the demo song, loop it 3 times. If it's a real MIDI file, just play it once.
    cascade.songQueue = customSong ? [...scaledSong] : [...scaledSong, ...scaledSong, ...scaledSong];
    cascadeFrameCount = 0;
    cascade.isPlaying = true;
}

// Function to spawn particles when you hit a note
function spawnExplosion(x, y) {
    for (let i = 0; i < 15; i++) {
        cascade.particles.push({
            x: x, y: y,
            vx: (Math.random() - 0.5) * 10,
            vy: (Math.random() - 0.5) * 10,
            life: 1.0
        });
    }
}

// --- THE REPLICANT ENGINE ---

function startReplicant() {
    if (!midiOut) { alert("Please click INIT SENSORS first so the Ghost can connect to your synth!"); return; }

    replicant.sequence = [];
    replicant.level = 1;
    document.getElementById('rep-level').innerText = "LVL 1";

    // Start the first round!
    nextReplicantRound();
}

function nextReplicantRound() {
    replicant.state = 'playing';
    replicant.playerStep = 0;

    const status = document.getElementById('rep-status');
    status.innerText = "🤖 GHOST IS PLAYING...";
    status.style.color = "yellow";
    status.style.textShadow = "0 0 10px yellow";

    // 1. Pick a random musical note based on your Theory Engine scale!
    let sRoot = parseInt(document.getElementById('scale-root').value) || 0;
    let sType = document.getElementById('scale-type').value || 'Pent Minor';
    let intervals = scaleDict[sType] || scaleDict['Major'];

    // Pick a random interval and keep it within a nice 2-octave range (starting at C3 = 48)
    let baseMidi = 48 + sRoot;
    let randomInterval = intervals[Math.floor(Math.random() * intervals.length)];
    let randomOctave = Math.floor(Math.random() * 2) * 12; // 0 or +12

    // Add the new note to the sequence
    replicant.sequence.push(baseMidi + randomInterval + randomOctave);

    // 2. The Playback Loop
    let i = 0;

    function playNextNote() {
        // If the ghost is done playing the sequence, switch to the player's turn!
        if (i >= replicant.sequence.length) {
            replicant.state = 'listening';
            status.innerText = "🟢 YOUR TURN!";
            status.style.color = "#00ffcc";
            status.style.textShadow = "0 0 10px #00ffcc";
            return;
        }

        let note = replicant.sequence[i];

        // Blast the note TO your physical synthesizer!
        midiOut.send([0x90, note, 100]); // Note ON

        // Light up the virtual keyboard on the screen
        let keyEl = document.getElementById('key-' + note);
        if (keyEl) keyEl.classList.add('active');

        // Turn the note off after 400 milliseconds
        setTimeout(() => {
            midiOut.send([0x80, note, 0]); // Note OFF
            if (keyEl) keyEl.classList.remove('active');

            i++;
            // Wait 200ms before playing the next note
            setTimeout(playNextNote, 200);
        }, 400);
    }

    // Give the player a 1-second breather before the sequence starts
    setTimeout(playNextNote, 1000);
}

// --- SIGHT-READING UI LOGIC ---
function startSightReader() {
    sightReader.score = 0;
    document.getElementById('staff-score').innerText = "0";
    sightReader.notes = [];
    sightReader.frameCount = 0;
    sightReader.isPlaying = true;
}

// --- TIMING TRAINER UI LOGIC ---
function toggleTimingTrainer() {
    if (!audioCtx) { alert("Please click INIT SENSORS first!"); return; }

    timingTrainer.on = !timingTrainer.on;
    const btn = document.getElementById('btn-timing');
    btn.innerText = timingTrainer.on ? "⏹️ STOP METRONOME" : "▶️ START METRONOME";

    if (timingTrainer.on) {
        timingTrainer.bpm = parseInt(document.getElementById('timing-bpm').value);
        timingTrainer.interval = (60 / timingTrainer.bpm) * 1000;
        timingTrainer.nextBeat = performance.now() + timingTrainer.interval;

        document.getElementById('timing-feedback').innerText = "PLAY ON THE BEAT!";
        document.getElementById('timing-feedback').style.color = "#888";
        document.getElementById('timing-feedback').style.textShadow = "none";
    }
}

// --- FULLSCREEN CONTROLLER ---
function toggleCascadeFullscreen() {
    const canvas = document.getElementById('cascade-canvas');
    if (!canvas) return;

    if (!document.fullscreenElement) {
        // Enter Fullscreen
        if (canvas.requestFullscreen) {
            canvas.requestFullscreen();
        } else if (canvas.webkitRequestFullscreen) { /* Safari */
            canvas.webkitRequestFullscreen();
        }
    } else {
        // Exit Fullscreen
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

// --- OSU! KEYS UI & MATH ---

function spawnOsuHitText(x, y, text, color) {
    osuGame.animations.push({ x: x, y: y, text: text, color: color, life: 1.0 });
}

function startOsu() {
    osuGame.score = 0;
    osuGame.combo = 0;
    document.getElementById('osu-score').innerText = "000000";
    document.getElementById('osu-combo').innerText = "0x";
    osuGame.hitObjects = [];
    osuGame.animations = [];
    
    // Use your custom MIDI file if loaded, otherwise use demo
    let targetSong = (typeof customSong !== 'undefined' && customSong) ? customSong : demoSong;
    
    // We must convert the relative frames into Absolute Timestamps for osu! rings
    osuGame.songQueue = [];
    let absoluteTime = performance.now() + 2000; // Give player 2 seconds to get ready

    targetSong.forEach(note => {
        // Convert frames to milliseconds (assuming 60fps)
        let delayMs = (note.delay / 60) * 1000; 
        absoluteTime += delayMs;

        osuGame.songQueue.push({
            pitch: note.pitch,
            targetTime: absoluteTime,
            spawnTime: absoluteTime - osuGame.approachTime, // Spawn the circle early so the ring can shrink!
            y: 100 + (Math.random() * 200) // Randomize the vertical position for true osu! feel
        });
    });

    osuGame.isPlaying = true;
}