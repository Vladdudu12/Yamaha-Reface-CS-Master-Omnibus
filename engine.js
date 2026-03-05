// --- 1. MIDI I/O & ROUTING ---
if (navigator.requestMIDIAccess) {
    navigator.requestMIDIAccess().then(access => {
        if (access.outputs.size > 0) {
            midiOut = Array.from(access.outputs.values())[0];

            // --- NEW: MEMORY RECALL ---
            // The moment we connect, grab the last known state from the hard drive
            let lastState = JSON.parse(localStorage.getItem('reface_memory') || '{}');

            Object.keys(lastState).forEach(ccString => {
                let ccNum = parseInt(ccString);
                let val = lastState[ccString];

                // 1. Blast the value TO the synthesizer's digital brain
                midiOut.send([0xB0, ccNum, val]);

                // 2. Snap the Web UI sliders to match
                if (typeof ccMap !== 'undefined' && ccMap[ccNum]) {
                    const el = document.getElementById(ccMap[ccNum]);
                    if (el) {
                        let n = Math.round((val / 127) * (parseInt(el.max) - parseInt(el.min))) + parseInt(el.min);
                        if (el.id === 'efft') n = (parseInt(el.max) + parseInt(el.min)) - n;
                        el.value = n;
                    }
                }
            });
        }
        document.getElementById('midi-status').innerText = "MIDI READY (LOCAL OFF RECOMMENDED)"; document.getElementById('midi-status').style.color = "var(--match-green)";

        for (let input of access.inputs.values()) {
            input.onmidimessage = (msg) => {
                const [s, d1, d2] = msg.data; const cmd = s & 0xF0;

                // --- EXTERNAL MIDI CLOCK SYNC (Reface Tempo Slider) ---
                if (s === 0xF8) { // 0xF8 is the universal MIDI Clock Pulse
                    const now = performance.now();

                    if (lastClockTick > 0) {
                        const delta = now - lastClockTick;
                        clockDeltas.push(delta);

                        // We need exactly 24 pulses to calculate 1 full beat (Quarter Note)
                        if (clockDeltas.length > 24) clockDeltas.shift();

                        // Once we have a full beat of data, calculate the BPM!
                        if (clockDeltas.length === 24) {
                            const beatDurationMs = clockDeltas.reduce((a, b) => a + b, 0);
                            const calculatedBpm = Math.round(60000 / beatDurationMs);

                            const bpmSlider = document.getElementById('arp-bpm');
                            const bpmVal = document.getElementById('arp-bpm-val');

                            // If the BPM has changed, update our Web App's Master BPM slider!
                            if (bpmSlider && Math.abs(bpmSlider.value - calculatedBpm) > 0) {
                                // Clamp it between our slider's min (60) and max (240)
                                bpmSlider.value = Math.max(bpmSlider.min, Math.min(bpmSlider.max, calculatedBpm));
                                if (bpmVal) {
                                    bpmVal.innerText = bpmSlider.value;
                                    // Give it a cool green glow to show it's externally synced
                                    bpmVal.style.color = "var(--match-green)";
                                    bpmVal.style.textShadow = "0 0 10px var(--match-green)";
                                }
                            }
                        }
                    }
                    lastClockTick = now;
                    return; // Stop processing, this was just a clock pulse!
                }

                // --- SYNTH LOOPER PLAY/STOP DETECTION ---
                if (s === 0xFA || s === 0xFB) {
                    console.log("Reface Looper Started!"); return;
                }
                if (s === 0xFC) {
                    console.log("Reface Looper Stopped!"); return;
                }

                // Handle Knobs / Sliders
                if (cmd === 0xB0) {

                    // --- 👻 GHOST MOTION RECORDER ---
                    if (typeof motionSeq !== 'undefined' && motionSeq.isRecording) {
                        let elapsed = (performance.now() - motionSeq.playStart) % motionSeq.loopLengthMs;
                        let currentPct = elapsed / motionSeq.loopLengthMs;

                        // Save the exact fraction of a second, the CC (d1), and the value (d2)!
                        motionSeq.events.push({ timePct: currentPct, cc: d1, val: d2 });
                    }
                    // ---------------------------------

                    if (isLearning) {
                        ccMap[d1] = isLearning;
                        localStorage.setItem('ref_cc_omnibus', JSON.stringify(ccMap));
                        isLearning = null;
                    }
                    else if (ccMap[d1]) {
                        const id = ccMap[d1];
                        const el = document.getElementById(id);
                        if (el) {
                            let n = Math.round((d2 / 127) * (parseInt(el.max) - parseInt(el.min))) + parseInt(el.min);
                            if (id === 'efft') n = (parseInt(el.max) + parseInt(el.min)) - n;
                            el.value = n;

                            update(id, true);
                        }

                        // --- NEW: AUTO-SAVE STATE ---
                        // Quietly save this exact slider position to the browser's long-term memory
                        let lastState = JSON.parse(localStorage.getItem('reface_memory') || '{}');
                        lastState[d1] = d2;
                        localStorage.setItem('reface_memory', JSON.stringify(lastState));
                    }
                    return;
                }

                const isNoteOn = (cmd === 0x90 && d2 > 0);
                const isNoteOff = (cmd === 0x80 || (cmd === 0x90 && d2 === 0));

                // Modulator: Velocity to Filter
                if (isNoteOn && mod.velOn && midiOut) {
                    const amt = document.getElementById('vel-amt').value / 100;
                    const baseCut = document.getElementById('fcut').value;
                    const ccBase = (baseCut - 1) * (127 / 11);
                    const offset = ((d2 - 64) / 64) * amt * 64;
                    midiOut.send([0xB0, 74, Math.max(0, Math.min(127, ccBase + offset))]);
                }

                // Looper Recording
                for (let i = 0; i < 4; i++) {
                    if (looper.tracks[i].rec) {
                        if (looper.loopLength === 0 && isNoteOn && looper.tracks[i].events.length === 0) looper.time = 0;
                        looper.tracks[i].events.push({ type: isNoteOn ? 0x90 : 0x80, note: d1, vel: d2, time: looper.time });
                    }
                }

                // Arpeggiator & Theory Intake
                if (isNoteOn) {
                    triggerEnvAttack();
                    if (!activeNotes.includes(d1)) { activeNotes.push(d1); activeNotes.sort((a, b) => a - b); document.getElementById('key-' + d1)?.classList.add('active'); decodeChord(); }
                    if (arp.on) {
                        if (!arp.latch || arp.held.length === 0) { arp.held.push(d1); arp.notes = [...arp.held].sort((a, b) => a - b); }
                        else if (arp.latch) {
                            let allReleased = !activeNotes.some(n => n !== d1);
                            if (allReleased) { arp.held = [d1]; } else { arp.held.push(d1); }
                            arp.notes = [...arp.held].sort((a, b) => a - b);
                        }
                    }
                }
                else if (isNoteOff) {
                    if (activeNotes.length <= 1) triggerEnvRelease();
                    activeNotes = activeNotes.filter(n => n !== d1); document.getElementById('key-' + d1)?.classList.remove('active'); decodeChord();
                    if (arp.on && !arp.latch) { arp.held = arp.held.filter(n => n !== d1); arp.notes = [...arp.held].sort((a, b) => a - b); }
                }
            };
        }
    });
}

// --- 2. MASTER SEQUENCER CLOCK ---
setInterval(() => {
    const now = performance.now();
    const delta = now - looper.lastTick;
    looper.lastTick = now;

    // LFO 2
    if (mod.lfo2On && midiOut) {
        const rate = document.getElementById('lfo2-rate').value / 5;
        const depth = document.getElementById('lfo2-depth').value;
        mod.lfo2Phase += (rate * (delta / 1000));
        const offset = Math.sin(mod.lfo2Phase) * depth;
        const baseCut = document.getElementById('fcut').value;
        const ccBase = (baseCut - 1) * (127 / 11);
        midiOut.send([0xB0, 74, Math.max(0, Math.min(127, ccBase + offset))]);
    }

    // Arpeggiator
    if (arp.on && arp.notes.length > 0 && midiOut) {
        const bpm = document.getElementById('arp-bpm').value;
        const interval = (60 / bpm) * 1000 / 2;
        if (now - arp.lastTick >= interval) {
            arp.lastTick = now;
            const mode = document.getElementById('arp-mode').value;
            if (mode === 'up') arp.index = (arp.index + 1) % arp.notes.length;
            else if (mode === 'down') arp.index = (arp.index - 1 + arp.notes.length) % arp.notes.length;
            else arp.index = Math.floor(Math.random() * arp.notes.length);

            const note = arp.notes[arp.index];
            midiOut.send([0x90, note, 100]);
            const gate = interval * (document.getElementById('arp-gate').value / 100);
            setTimeout(() => { if (midiOut) midiOut.send([0x80, note, 0]); }, gate);
        }
    }

    // Looper 
    if (looper.loopLength > 0) {
        let prevTime = looper.time;
        looper.time += delta;
        if (looper.time >= looper.loopLength) {
            looper.time = looper.time % looper.loopLength;
            prevTime = -1;
            looper.tracks.forEach(t => t.events.forEach(e => e.played = false));
        }
        if (midiOut) {
            looper.tracks.forEach(t => {
                if (!t.rec) {
                    t.events.forEach(e => {
                        if (!e.played && e.time > prevTime && e.time <= looper.time) {
                            midiOut.send([e.type, e.note, e.vel]);
                            e.played = true;
                        }
                    });
                }
            });
        }
    } else if (looper.tracks.some(t => t.rec)) {
        looper.time += delta;
    }

    // --- Step Sequencer Engine ---
    if (seq.on && midiOut) {
        const bpm = document.getElementById('arp-bpm').value;
        const stepInterval = (60 / bpm) * 1000 / 4;

        if (now - seq.lastTick >= stepInterval) {
            seq.lastTick = now;

            // 1. Manage the visual playhead
            if (seq.currentStep >= 0) {
                document.getElementById('step-' + seq.currentStep)?.classList.remove('playing');
            }
            seq.currentStep = (seq.currentStep + 1) % 16;
            document.getElementById('step-' + seq.currentStep)?.classList.add('playing');

            // 2. SWING MATH: If it's an off-beat (1, 3, 5, 7...), calculate a slight delay!
            const swingPct = document.getElementById('seq-swing').value / 100;
            let swingDelayMs = 0;
            if (seq.currentStep % 2 !== 0) {
                // Max swing delays the note by exactly half a step
                swingDelayMs = (stepInterval / 2) * swingPct;
            }

            // 3. Loop through all 4 Tracks and play them simultaneously
            seq.tracks.forEach((track) => {
                if (track.playing) {
                    let step = track.steps[seq.currentStep];

                    if (step.active) {
                        // We use setTimeout to dynamically inject the Swing Delay!
                        setTimeout(() => {
                            // Send P-Locks first!
                            if (step.cut > 0) {
                                const ccVal = Math.round(((step.cut - 1) / 11) * 127);
                                midiOut.send([0xB0, 74, ccVal]);
                            }
                            // Send the Note
                            midiOut.send([0x90, step.note, 100]);

                            // Schedule Note Off
                            setTimeout(() => {
                                if (midiOut) midiOut.send([0x80, step.note, 0]);
                            }, stepInterval * 0.8);

                        }, swingDelayMs); // <-- The swing delay is applied here!
                    }
                }
            });
        }
    }

    // --- Turing Machine Engine ---
    if (turing.on && midiOut) {
        const bpm = document.getElementById('arp-bpm').value;
        // Turing sequences usually play a bit slower (8th notes instead of 16ths)
        const stepInterval = (60 / bpm) * 1000 / 2;

        if (now - turing.lastTick >= stepInterval) {
            turing.lastTick = now;
            turing.currentStep = (turing.currentStep + 1) % turing.length;
            turing.mutatedThisStep = false;

            // 1. Roll the dice! Check mutation probability.
            if (Math.random() * 100 < turing.mutation) {
                turing.sequence[turing.currentStep] = generateScaleNote();
                turing.mutatedThisStep = true;
            }

            const note = turing.sequence[turing.currentStep];

            // Update the UI visualizer
            if (typeof updateTuringVis === "function") updateTuringVis();

            // Play the Note
            midiOut.send([0x90, note, 90]);

            // Schedule Note Off (Slightly legato for ambient feels)
            setTimeout(() => {
                if (midiOut) midiOut.send([0x80, note, 0]);
            }, stepInterval * 0.85);
        }
    }

    // --- Custom Drawable LFO Engine ---
    if (drawLfo.on && midiOut) {
        const rate = document.getElementById('draw-lfo-rate').value / 50;
        const depth = document.getElementById('draw-lfo-depth').value / 100;
        const targetCC = parseInt(document.getElementById('draw-lfo-target').value);

        // 1. Advance the Playhead
        drawLfo.phase += (rate * (delta / 1000));
        if (drawLfo.phase >= 1.0) drawLfo.phase -= 1.0;

        // 2. Find exactly where we are on the drawn path
        const index = Math.floor(drawLfo.phase * drawLfo.resolution);
        const nextIndex = (index + 1) % drawLfo.resolution;
        const fraction = (drawLfo.phase * drawLfo.resolution) - index;

        const val1 = drawLfo.path[index];
        const val2 = drawLfo.path[nextIndex];
        const interpVal = val1 + (val2 - val1) * fraction;

        // 3. Calculate how hard to push the slider
        const offset = (interpVal - 0.5) * 2 * depth * 63;

        // 4. Find the base value of the UI slider
        let baseValStr = 64;
        if (targetCC === 74) baseValStr = document.getElementById('fcut').value;
        else if (targetCC === 109) baseValStr = document.getElementById('fres').value;
        else if (targetCC === 103) baseValStr = document.getElementById('lfod').value;

        const ccBase = ((parseInt(baseValStr) - 1) / 11) * 127;
        const finalCC = Math.max(0, Math.min(127, Math.round(ccBase + offset)));

        // 5. THE FIX: Safety Throttle & Delta Check
        // Only calculate output every 30ms (~33 fps), and ONLY send if the value changed!
        if (now - drawLfo.lastTick > 30) {
            drawLfo.lastTick = now;

            if (drawLfo.lastSentCC !== finalCC) {
                drawLfo.lastSentCC = finalCC;
                midiOut.send([0xB0, targetCC, finalCC]);
            }
        }
    }

    // --- Audio-Reactive Sidechain Engine ---
    if (sidechain.on && analyser && midiOut) {
        // 1. Get raw audio volume (RMS) from the microphone
        const buffer = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(buffer);
        let rms = 0;
        for (let i = 0; i < buffer.length; i++) rms += buffer[i] * buffer[i];
        rms = Math.sqrt(rms / buffer.length);

        // 2. Smooth the envelope (Instant Attack, Slow Release)
        if (rms > sidechain.smoothedLevel) {
            sidechain.smoothedLevel = rms; // Instant jump when kick drum hits
        } else {
            sidechain.smoothedLevel = sidechain.smoothedLevel * 0.85; // Smooth fade out
        }

        // 3. Map to UI Settings
        const threshold = document.getElementById('sc-thresh').value / 100;
        const depth = document.getElementById('sc-depth').value / 100;
        const targetCC = parseInt(document.getElementById('sc-target').value);

        // Microphones are quiet, so we scale the volume up by 5 for the math
        let scaledLevel = Math.min(1.0, sidechain.smoothedLevel * 5);

        let duckAmount = 0;
        if (scaledLevel > threshold) {
            // Calculate how far the volume went OVER the threshold
            let over = (scaledLevel - threshold) / (1.0 - threshold);
            duckAmount = over * depth;
        }

        // Update the visual meter in app.js
        if (typeof updateSidechainMeter === "function") {
            updateSidechainMeter(scaledLevel, threshold);
        }

        // 4. Calculate the MIDI Output
        let baseValStr = 127; // Default max volume for CC 11 (Expression)
        if (targetCC === 74) {
            // If ducking the Filter, duck from the physical slider's current position
            baseValStr = ((parseInt(document.getElementById('fcut').value) - 1) / 11) * 127;
        }

        // Subtract the ducking amount from the base value
        const finalCC = Math.max(0, Math.min(127, Math.round(baseValStr - (duckAmount * 127))));

        // 5. Fire to hardware! (With delta throttle to prevent MIDI crashing)
        if (sidechain.lastSentCC !== finalCC) {
            sidechain.lastSentCC = finalCC;
            midiOut.send([0xB0, targetCC, finalCC]);
        }
    }

    // --- Vocal Controller (Pitch-to-MIDI) Engine ---
    if (vocalCtrl.on && analyser && midiOut) {
        // We only calculate pitch every 40ms (~25 times a sec) to prevent overwhelming the synth
        if (now - vocalCtrl.lastTick > 40) {
            vocalCtrl.lastTick = now;

            // 1. Get raw audio volume
            const tData = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(tData);
            let rms = 0;
            for (let i = 0; i < tData.length; i++) rms += tData[i] * tData[i];
            const volume = Math.sqrt(rms / tData.length);

            // The Noise Gate prevents background hum from playing notes
            const gateThreshold = document.getElementById('vocal-gate').value / 1000;

            if (volume > gateThreshold) {
                // 2. Autocorrelation (Pitch Detection Math)
                let cArr = new Array(tData.length).fill(0);
                for (let i = 0; i < tData.length; i++)
                    for (let j = 0; j < tData.length - i; j++)
                        cArr[i] += tData[j] * tData[j + i];

                let d = 0; while (cArr[d] > cArr[d + 1]) d++;
                let mx = -1, mp = -1;
                for (let i = d; i < tData.length; i++) {
                    if (cArr[i] > mx) { mx = cArr[i]; mp = i; }
                }

                const freq = audioCtx.sampleRate / mp;

                // 3. Human voice range filter (~60Hz to ~1200Hz)
                if (freq > 60 && freq < 1500) {
                    // Convert Frequency (Hz) to MIDI Note Number
                    const midiNote = Math.round(12 * Math.log2(freq / 440) + 69);

                    // If the pitch changed to a NEW note...
                    if (midiNote !== vocalCtrl.activeNote) {

                        // Tell the synth to stop playing the old note
                        if (vocalCtrl.activeNote !== -1) {
                            midiOut.send([0x80, vocalCtrl.activeNote, 0]);
                        }

                        // Tell the synth to play the new note!
                        midiOut.send([0x90, midiNote, 100]);
                        vocalCtrl.activeNote = midiNote;

                        // Update the screen
                        if (typeof updateVocalUI === "function") updateVocalUI(midiNote);
                    }
                }
            } else {
                // Volume dropped below the Noise Gate (You stopped singing)
                if (vocalCtrl.activeNote !== -1) {
                    midiOut.send([0x80, vocalCtrl.activeNote, 0]); // Note Off
                    vocalCtrl.activeNote = -1;
                    if (typeof updateVocalUI === "function") updateVocalUI(-1);
                }
            }
        }
    }

    // --- Cellular Automata Engine ---
    if (life.on && midiOut) {
        const bpm = document.getElementById('arp-bpm').value;
        const stepInterval = (60 / bpm) * 1000 / 4; // 16th notes

        if (now - life.lastTick >= stepInterval) {
            life.lastTick = now;

            // Remove playhead highlight from previous column
            if (life.currentStep >= 0) {
                for (let r = 0; r < life.height; r++) {
                    document.getElementById(`life-${r}-${life.currentStep}`)?.classList.remove('playing');
                }
            }

            life.currentStep++;

            // EVOLUTION: When the playhead hits the end, the grid breeds and mutates!
            if (life.currentStep >= life.width) {
                life.currentStep = 0;
                if (typeof evolveLife === "function") evolveLife();
            }

            // Draw new playhead highlight
            for (let r = 0; r < life.height; r++) {
                document.getElementById(`life-${r}-${life.currentStep}`)?.classList.add('playing');
            }

            // --- MUSIC THEORY MAPPING ---
            let sRoot = parseInt(document.getElementById('scale-root').value) || 0;
            let sType = document.getElementById('scale-type').value;
            let intervals = scaleDict[sType] || scaleDict['Major']; // Default to Major

            // Loop through the 8 cells in the current column
            for (let r = 0; r < life.height; r++) {
                if (life.grid[r][life.currentStep]) {
                    // Map row (0-7, top-to-bottom) to scale pitches
                    // Row 7 (bottom) = Root Note. Row 0 (top) = High Note.
                    let degree = (life.height - 1) - r;
                    let octaveOffset = Math.floor(degree / intervals.length);
                    let intervalIdx = degree % intervals.length;

                    let baseMidi = 48; // Starts at C3
                    let note = baseMidi + sRoot + intervals[intervalIdx] + (octaveOffset * 12);

                    // Fire the MIDI note!
                    midiOut.send([0x90, note, 90]);

                    // Schedule Note Off
                    setTimeout(() => {
                        if (midiOut) midiOut.send([0x80, note, 0]);
                    }, stepInterval * 0.8);
                }
            }
        }
    }

    // --- 3D Auto-Orbit Engine ---
    if (spatializer.on && spatializer.autoOrbit && spatializer.panner && !spatializer.isDragging) {
        // 1. Calculate the rotation speed
        const speed = document.getElementById('orbit-speed').value / 1000;
        spatializer.orbitPhase += speed;
        if (spatializer.orbitPhase > Math.PI * 2) spatializer.orbitPhase -= Math.PI * 2; // Keep it within a circle

        // 2. Trigonometry to calculate a perfect circular orbit
        const radius = parseFloat(document.getElementById('orbit-radius').value); // READ THE SLIDER!
        const mapX = Math.sin(spatializer.orbitPhase) * radius; // Left/Right
        const mapZ = Math.cos(spatializer.orbitPhase) * radius; // Front/Back

        // 3. Move the audio source smoothly
        spatializer.panner.positionX.setTargetAtTime(mapX, audioCtx.currentTime, 0.05);
        spatializer.panner.positionZ.setTargetAtTime(mapZ, audioCtx.currentTime, 0.05);

        // 4. Send coordinates to the UI so the green dot moves automatically!
        if (typeof updateRadarUI === "function") {
            updateRadarUI(mapX, mapZ);
        }
    }

    // --- Ghost Motion Sequencer Engine ---
    if (motionSeq.isPlaying || motionSeq.isRecording) {
        let lengthMs = parseInt(document.getElementById('motion-length').value) * 1000;
        motionSeq.loopLengthMs = lengthMs;

        // Calculate where the playhead is right now (0.0 to 1.0)
        let elapsed = (now - motionSeq.playStart) % lengthMs;
        let currentPct = elapsed / lengthMs;

        // Update the visual playhead bar on the screen
        let ph = document.getElementById('motion-playhead');
        if (ph) ph.style.width = (currentPct * 100) + '%';

        // If PLAYING, fire recorded events!
        if (motionSeq.isPlaying && !motionSeq.isRecording && midiOut) {
            motionSeq.events.forEach(ev => {
                let triggered = false;

                // Normal playback check
                if (currentPct > motionSeq.lastTickPct) {
                    if (ev.timePct >= motionSeq.lastTickPct && ev.timePct < currentPct) triggered = true;
                } else {
                    // The loop just wrapped around from 1.0 back to 0.0!
                    if (ev.timePct >= motionSeq.lastTickPct || ev.timePct < currentPct) triggered = true;
                }

                if (triggered) {
                    midiOut.send([0xB0, ev.cc, ev.val]);
                }
            });
        }

        motionSeq.lastTickPct = currentPct;
    }

    // --- Trance-Gate Clock Engine ---
    if (typeof tGate !== 'undefined' && tGate.on && tGate.gainNode) {
        // Grab the BPM from your arpeggiator to ensure perfect sync
        const bpmInput = document.getElementById('arp-bpm');
        const bpm = bpmInput ? parseFloat(bpmInput.value) : 120;
        const stepInterval = (60 / bpm) * 1000 / 4; // Calculate 16th note timing

        if (now - tGate.lastTick >= stepInterval) {
            tGate.lastTick = now;

            // 1. Erase the playhead highlight from the previous step
            if (tGate.currentStep >= 0) {
                const oldStep = document.getElementById('tgate-' + tGate.currentStep);
                if (oldStep) oldStep.classList.remove('playing');
            }

            // 2. Advance to the next step (0 through 15)
            tGate.currentStep = (tGate.currentStep + 1) % 16;

            // 3. Draw the playhead highlight on the new step
            const newStep = document.getElementById('tgate-' + tGate.currentStep);
            if (newStep) newStep.classList.add('playing');

            // 4. THE AUDIO CHOPPER: Check if the current box is green (true) or dark (false)
            const isActive = tGate.steps[tGate.currentStep];

            // Snap the volume to 1.0 (ON) or 0.0 (OFF) 
            // We use a tiny 0.015s glide so the speakers don't "pop" or click aggressively
            tGate.gainNode.gain.setTargetAtTime(isActive ? 1.0 : 0.0, audioCtx.currentTime, 0.015);
        }
    }
}, 16);

// --- 3. THEORY & AUDIO VISUALIZERS ---
function updateTheoryUI() {
    document.querySelectorAll('.key').forEach(k => { k.classList.remove('scale-mark'); k.classList.remove('ghost-mark'); });
    const sRoot = parseInt(document.getElementById('scale-root').value); const sType = document.getElementById('scale-type').value;
    if (sType !== 'None') { const intervals = scaleDict[sType]; for (let i = 48; i <= 84; i++) if (intervals.includes((i - sRoot) % 12)) document.getElementById('key-' + i).classList.add('scale-mark'); }
    const gType = document.getElementById('ghost-type').value;
    if (gType !== 'None' && activeNotes.length === 1) { const root = activeNotes[0]; ghostDict[gType].forEach(int => { const t = root + int; if (t <= 84 && t !== root) document.getElementById('key-' + t)?.classList.add('ghost-mark'); }); }
}

function decodeChord() {
    const display = document.getElementById('chord-display'); updateTheoryUI();
    if (activeNotes.length === 0) { display.innerText = "PLAY A CHORD"; currentChordRoot = -1; drawCoF(); return; }
    if (activeNotes.length === 1) { display.innerText = noteNames[activeNotes[0] % 12] + " Note"; currentChordRoot = -1; drawCoF(); return; }
    const root = activeNotes[0]; let ints = [...new Set(activeNotes.map(n => (n - root) % 12))].sort((a, b) => a - b);
    const type = chordDict[ints.join(',')];
    if (type) { display.innerText = noteNames[root % 12] + " " + type; currentChordRoot = root % 12; currentChordQual = type.includes('Min') ? 'Minor' : 'Major'; } else { display.innerText = "Custom / Inversion"; currentChordRoot = -1; }
    drawCoF();
}

function drawCoF() {
    const c = document.getElementById('cof-canvas'); if (!c) return; const ctx = c.getContext('2d'); c.width = c.clientWidth; c.height = c.clientHeight; const cx = c.width / 2; const cy = c.height / 2; const r = cx * 0.75;
    ctx.clearRect(0, 0, c.width, c.height); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (let i = 0; i < 12; i++) {
        const noteIndex = cofOrder[i]; const angle = (i * 30 - 90) * Math.PI / 180; const x = cx + Math.cos(angle) * r; const y = cy + Math.sin(angle) * r;
        if (noteIndex === currentChordRoot) { ctx.fillStyle = currentChordQual === 'Major' ? 'var(--match-green)' : 'var(--target-blue)'; ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#000"; } else ctx.fillStyle = "#666";
        ctx.font = "bold 14px Arial"; ctx.fillText(noteNames[noteIndex], x, y);
        const minX = cx + Math.cos(angle) * (r * 0.6); const minY = cy + Math.sin(angle) * (r * 0.6);
        ctx.fillStyle = (noteIndex === currentChordRoot && currentChordQual === 'Minor') ? 'var(--match-green)' : "#444"; ctx.font = "10px Arial"; ctx.fillText(noteNames[(noteIndex + 9) % 12] + "m", minX, minY);
    }
}

function triggerEnvAttack() { envState = 'attack'; nOnTime = performance.now(); }
function triggerEnvRelease() { if (activeNotes.length === 0) { envState = 'release'; nOffTime = performance.now(); } }

function initLab() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser(); analyser.fftSize = 2048;

    // 1. Setup the 3D HRTF Panner
    spatializer.panner = audioCtx.createPanner();
    spatializer.panner.panningModel = 'HRTF'; // The magic Binaural math!
    spatializer.panner.distanceModel = 'inverse';
    spatializer.panner.refDistance = 1;
    spatializer.panner.maxDistance = 10000;
    spatializer.panner.rolloffFactor = 1;
    // Set initial position to dead-center
    spatializer.panner.positionX.value = 0;
    spatializer.panner.positionY.value = 0;
    spatializer.panner.positionZ.value = 0;

    // 2. Setup standard FX Nodes
    delayNode = audioCtx.createDelay(2.0);
    feedbackNode = audioCtx.createGain();
    delayMix = audioCtx.createGain();
    convolverNode = audioCtx.createConvolver();
    verbMix = audioCtx.createGain();
    dryGain = audioCtx.createGain();
    dryGain.gain.value = 0.0; // Keep dry muted to prevent feedback

    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        micSource = audioCtx.createMediaStreamSource(stream);
        audioDestNode = audioCtx.createMediaStreamDestination(); // For the Auto-Sampler

        // 3. NEW ROUTING: Mic goes into the 3D Panner first!
        micSource.connect(spatializer.panner);

        // Then the 3D Panner goes to the rest of the app
        spatializer.panner.connect(analyser);
        spatializer.panner.connect(dryGain);
        dryGain.connect(audioCtx.destination);
        dryGain.connect(audioDestNode);

        buildFXRouting();
        generateReverb();

        document.getElementById('note-out').innerText = "RDY";
        setTimeout(() => {
            if (typeof startOscilloscope === "function") startOscilloscope();
        }, 100);
    }).catch(e => alert("Please allow Mic access for FX & Scope."));
}

function toggleFreeze() { isFrozen = !isFrozen; document.getElementById('freeze-btn').innerText = isFrozen ? "RESUME" : "FREEZE"; document.getElementById('freeze-btn').style.background = isFrozen ? "var(--reface-accent)" : "#444"; }

function draw() {
    requestAnimationFrame(draw);

    // ADSR Graphics
    const eCv = document.getElementById('env-canvas'); const eCtx = eCv.getContext('2d'); eCv.width = eCv.clientWidth; eCv.height = eCv.clientHeight; const w = eCv.width; const h = eCv.height;
    const A = parseInt(document.getElementById('ega').value) / 12; const D = parseInt(document.getElementById('egd').value) / 12; const S = parseInt(document.getElementById('egs').value) / 12; const R = parseInt(document.getElementById('egr').value) / 12;
    const pA = w * 0.25 * A; const pD = pA + (w * 0.25 * D); const pSustEnd = w * 0.75; const pR = pSustEnd + (w * 0.25 * R); const yS = h - (S * h);
    eCtx.fillStyle = 'rgba(0,255,65,0.1)'; eCtx.strokeStyle = '#555'; eCtx.beginPath(); eCtx.moveTo(0, h); eCtx.lineTo(pA, 0); eCtx.lineTo(pD, yS); eCtx.lineTo(pSustEnd, yS); eCtx.lineTo(pR, h); eCtx.lineTo(0, h); eCtx.fill(); eCtx.stroke();
    if (envState !== 'idle') {
        let dX = 0, dY = h; const now = performance.now(); const tA = Math.max(A * 3000, 10); const tD = Math.max(D * 3000, 10); const tR = Math.max(R * 3000, 10); const elOn = now - nOnTime;
        if (['attack', 'decay', 'sustain'].includes(envState)) {
            if (elOn <= tA) { envState = 'attack'; const p = elOn / tA; dX = pA * p; dY = h - (h * p); rStartLvl = dY; } else if (elOn <= tA + tD) { envState = 'decay'; const p = (elOn - tA) / tD; dX = pA + ((pD - pA) * p); dY = yS * p; rStartLvl = dY; } else { envState = 'sustain'; dX = pSustEnd; dY = yS; rStartLvl = dY; }
        } else if (envState === 'release') { const elOff = now - nOffTime; if (elOff <= tR) { const p = elOff / tR; dX = pSustEnd + ((pR - pSustEnd) * p); dY = rStartLvl + ((h - rStartLvl) * p); } else { envState = 'idle'; dX = 0; dY = h; } }
        eCtx.fillStyle = '#fff'; eCtx.shadowBlur = 10; eCtx.shadowColor = '#00ff41'; eCtx.beginPath(); eCtx.arc(dX, dY, 5, 0, Math.PI * 2); eCtx.fill(); eCtx.shadowBlur = 0; eCtx.strokeStyle = 'rgba(255,255,255,0.5)'; eCtx.beginPath(); eCtx.moveTo(dX, h); eCtx.lineTo(dX, dY); eCtx.stroke();
    }

    // Scope
    if (isFrozen || !analyser) return;
    const c = document.getElementById('osc-canvas'); const ctx = c.getContext('2d'); if (c.width !== c.clientWidth || c.height !== c.clientHeight) { c.width = c.clientWidth; c.height = c.clientHeight; }
    const zoom = document.getElementById('scope-zoom').value; const gain = document.getElementById('scope-gain').value; const offset = parseInt(document.getElementById('scope-pos').value);
    const buf = analyser.frequencyBinCount; const data = new Uint8Array(buf); analyser.getByteTimeDomainData(data);
    let mean = 0; for (let i = 0; i < buf; i++) mean += data[i]; mean /= buf;
    ctx.clearRect(0, 0, c.width, c.height); ctx.strokeStyle = '#00ff41'; ctx.lineWidth = 3; ctx.shadowBlur = 10; ctx.shadowColor = '#00ff41'; ctx.beginPath();
    let sl = c.width / zoom; let x = 0; for (let i = 0; i < zoom; i++) { let y = (c.height / 2) + ((data[i] - mean) * gain) + offset; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); x += sl; } ctx.stroke(); ctx.shadowBlur = 0;

    // Tuner
    const tData = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(tData); let rms = 0; for (let i = 0; i < tData.length; i++) rms += tData[i] * tData[i];
    if (Math.sqrt(rms / tData.length) > 0.01) {
        let cArr = new Array(tData.length).fill(0); for (let i = 0; i < tData.length; i++) for (let j = 0; j < tData.length - i; j++) cArr[i] += tData[j] * tData[j + i];
        let d = 0; while (cArr[d] > cArr[d + 1]) d++; let mx = -1, mp = -1; for (let i = d; i < tData.length; i++) if (cArr[i] > mx) { mx = cArr[i]; mp = i; }
        const freq = audioCtx.sampleRate / mp; if (freq < 5000) { document.getElementById('freq-out').innerText = freq.toFixed(2) + " Hz"; document.getElementById('note-out').innerText = noteNames[Math.round(12 * Math.log2(freq / 440) + 69) % 12]; }
    }

    if (typeof renderDrawLfo === "function") renderDrawLfo(); // Animate custom LFO
}

function buildFXRouting() {
    if (!chorus.inputNode) buildChorusCircuit();
    if (!crusher.inputNode) buildCrusherCircuit();
    if (!tGate.gainNode) buildGateCircuit(); // <-- ADDED THIS
    if (!stutter.inputNode) buildStutterCircuit();

    try {
        spatializer.panner.disconnect();
        crusher.outputNode.disconnect();
        chorus.outputNode.disconnect();
        tGate.gainNode.disconnect();
        stutter.outputNode.disconnect();
    } catch (e) { }

    let mainSignalSource = spatializer.panner;

    if (crusher.on) {
        spatializer.panner.connect(crusher.inputNode);
        mainSignalSource = crusher.outputNode;
    }

    if (chorus.on) {
        mainSignalSource.connect(chorus.inputNode);
        mainSignalSource = chorus.outputNode;
    }

    // Route through the Trance Gate volume node!
    mainSignalSource.connect(tGate.gainNode);
    mainSignalSource = tGate.gainNode;

    // Route into the MPC Stutter
    mainSignalSource.connect(stutter.inputNode);
    mainSignalSource = stutter.outputNode;

    dryGain.gain.value = 1.0;
    mainSignalSource.connect(dryGain);
    // --- STEREO LISSAJOUS ROUTING ---
    // 1. Create the splitters and analysers if they don't exist yet
    if (!splitterNode) {
        splitterNode = audioCtx.createChannelSplitter(2);
        analyserL = audioCtx.createAnalyser();
        analyserR = audioCtx.createAnalyser();

        // Use a large buffer for smooth, continuous geometric lines
        analyserL.fftSize = 2048;
        analyserR.fftSize = 2048;
    }

    try { mainSignalSource.disconnect(splitterNode); } catch (e) { }

    // 2. Route the final master audio into the splitter
    mainSignalSource.connect(splitterNode);

    // 3. Send the Left ear to Analyser L, and the Right ear to Analyser R
    splitterNode.connect(analyserL, 0);
    splitterNode.connect(analyserR, 1);

    mainSignalSource.connect(analyser);

    if (fxState.delay) {
        mainSignalSource.connect(delayNode);
        delayNode.connect(feedbackNode);
        feedbackNode.connect(delayNode);
        delayNode.connect(delayMix);
        delayMix.connect(audioCtx.destination);
    }
    if (fxState.verb) {
        if (fxState.delay) delayNode.connect(convolverNode);
        else mainSignalSource.connect(convolverNode);

        convolverNode.connect(verbMix);
        verbMix.connect(audioCtx.destination);
    }


    updateFX();
}

function updateFX() {
    if (!audioCtx) return;
    delayNode.delayTime.value = document.getElementById('fx-dly-time').value / 100 * 1.5;
    feedbackNode.gain.value = document.getElementById('fx-dly-fb').value / 100;
    delayMix.gain.value = document.getElementById('fx-dly-mix').value / 100;
    verbMix.gain.value = document.getElementById('fx-verb-mix').value / 100;
}

function generateReverb() {
    if (!audioCtx) return;
    const size = document.getElementById('fx-verb-size').value / 100;
    const length = audioCtx.sampleRate * (size * 5 + 0.5); // 0.5s to 5.5s decay
    const impulse = audioCtx.createBuffer(2, length, audioCtx.sampleRate);
    const L = impulse.getChannelData(0); const R = impulse.getChannelData(1);
    for (let i = 0; i < length; i++) {
        const decay = Math.pow(1 - i / length, 3);
        L[i] = (Math.random() * 2 - 1) * decay;
        R[i] = (Math.random() * 2 - 1) * decay;
    }
    convolverNode.buffer = impulse;
}

// --- MACRO SUPER KNOB ENGINE ---
function fireMacro1(val) {
    // Math mapping: 0-100 screen value to 1-12 synth slider range
    const mappedVal = Math.round(1 + (val / 100) * 11);

    document.getElementById('fcut').value = mappedVal;
    document.getElementById('fres').value = mappedVal;
    document.getElementById('lfod').value = mappedVal;

    // Visually update the UI text (Pass true so they don't double-fire MIDI)
    update('fcut', true); update('fres', true); update('lfod', true);

    // Fire one clean batch of MIDI to the Hardware
    if (midiOut) {
        const midiCCVal = Math.round((val / 100) * 127);
        midiOut.send([0xB0, 74, midiCCVal]); // Cutoff
        midiOut.send([0xB0, 109, midiCCVal]); // Reso
        midiOut.send([0xB0, 103, midiCCVal]); // LFO Depth
    }
}


// --- XY VECTOR SYNTHESIS MATH ---
let lastMorphTime = 0;

// We specifically EXCLUDE 'osct' (Osc Type), 'efft' (Effect Type), 
// 'lfoa' (LFO Target), and 'port' (Poly/Mono) because morphing switches crashes the audio.
const SAFE_MORPH_PARAMS = ['osctxt', 'oscmod', 'fcut', 'fres', 'lfod', 'lfos', 'ega', 'egd', 'egs', 'egr', 'effd', 'effr'];

function calculateXYMorph(x, y) {
    if (!xyState.A || !xyState.B || !xyState.C || !xyState.D) return;

    // THROTTLE: Only send MIDI every 40 milliseconds (~25fps) to prevent choking the hardware
    const now = performance.now();
    if (now - lastMorphTime < 40) return;
    lastMorphTime = now;

    // x and y are normalized 0.0 to 1.0
    SAFE_MORPH_PARAMS.forEach(id => {
        const valA = parseInt(xyState.A[id]);
        const valB = parseInt(xyState.B[id]);
        const valC = parseInt(xyState.C[id]);
        const valD = parseInt(xyState.D[id]);

        // Bilinear Interpolation Formula
        const topVal = valA * (1 - x) + valB * x;
        const botVal = valC * (1 - x) + valD * x;
        const finalVal = Math.round(topVal * (1 - y) + botVal * y);

        // Update UI
        document.getElementById(id).value = finalVal;
        update(id, true); // Visual only, prevents feedback loop

        // Send to Hardware
        if (midiOut) {
            let ccNum = Object.keys(ccMap).find(k => ccMap[k] === id);
            if (ccNum) {
                const el = document.getElementById(id);
                let midiVal = Math.round(((finalVal - el.min) / (el.max - el.min)) * 127);
                midiOut.send([0xB0, parseInt(ccNum), midiVal]);
            }
        }
    });
}

// --- GENERATIVE NOTE ALGORITHM ---
function generateScaleNote() {
    let sRoot = parseInt(document.getElementById('scale-root').value) || 0;
    let sType = document.getElementById('scale-type').value;

    // Default to C Major if the user hasn't selected a scale yet
    let intervals = scaleDict[sType];
    if (!intervals || sType === 'None') {
        sRoot = 0; // C
        intervals = scaleDict['Major'];
    }

    // Pick a random interval from the allowed scale
    let randomInterval = intervals[Math.floor(Math.random() * intervals.length)];

    // Pick a random octave (Octaves 3, 4, or 5 to keep it in a musical range)
    let randomOctave = Math.floor(Math.random() * 3) + 4;
    let baseMidi = (randomOctave * 12);

    return baseMidi + sRoot + randomInterval;
}


// --- WEBCAM THEREMIN ENGINE ---
function processThereminHands(results) {
    if (!theremin.on || !midiOut) return;

    // 1. Draw the Video and Hand Skeletons to the Canvas
    thCtx.save();
    thCtx.clearRect(0, 0, thCanvas.width, thCanvas.height);
    thCtx.drawImage(results.image, 0, 0, thCanvas.width, thCanvas.height);

    // Throttle MIDI to ~30 FPS to prevent crashing the synth
    const now = performance.now();
    const canSendMidi = (now - theremin.lastTick > 30);
    if (canSendMidi) theremin.lastTick = now;

    if (results.multiHandLandmarks) {
        for (let i = 0; i < results.multiHandLandmarks.length; i++) {
            const landmarks = results.multiHandLandmarks[i];
            const handedness = results.multiHandedness[i].label; // "Left" or "Right"

            // Draw a glowing circle on the palm (Landmark 9)
            const palm = landmarks[9];
            thCtx.beginPath();
            thCtx.arc(palm.x * thCanvas.width, palm.y * thCanvas.height, 10, 0, 2 * Math.PI);
            thCtx.fillStyle = handedness === "Left" ? "#2980b9" : "#00ff41";
            thCtx.fill();
            thCtx.shadowBlur = 15;
            thCtx.shadowColor = thCtx.fillStyle;

            if (canSendMidi) {
                // Notice: Because the canvas is physically mirrored, the AI's "Left" hand 
                // is actually your physical RIGHT hand!

                if (handedness === "Right") { // YOUR PHYSICAL LEFT HAND (Y-Axis)
                    const targetLeft = parseInt(document.getElementById('theremin-left').value);
                    // palm.y is 0.0 at top, 1.0 at bottom. Invert it so UP = Higher Value.
                    let valY = Math.max(0, Math.min(1, 1.0 - palm.y));
                    let midiVal = Math.round(valY * 127);

                    if (midiVal !== theremin.lastLeftCC) {
                        midiOut.send([0xB0, targetLeft, midiVal]);
                        theremin.lastLeftCC = midiVal;
                    }
                }
                else if (handedness === "Left") { // YOUR PHYSICAL RIGHT HAND (X-Axis)
                    const targetRight = parseInt(document.getElementById('theremin-right').value);
                    // palm.x is 0.0 at left, 1.0 at right.
                    let valX = Math.max(0, Math.min(1, palm.x));
                    let midiVal = Math.round(valX * 127);

                    if (midiVal !== theremin.lastRightCC) {
                        midiOut.send([0xB0, targetRight, midiVal]);
                        theremin.lastRightCC = midiVal;
                    }
                }
            }
        }
    }
    thCtx.restore();
}

// --- GRAVITY PHYSICS ENGINE ---
function gravLoop() {
    requestAnimationFrame(gravLoop);
    const cvs = document.getElementById('grav-canvas');
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    const w = cvs.width; const h = cvs.height;

    ctx.clearRect(0, 0, w, h);

    const gravity = document.getElementById('grav-g').value / 50;
    const bounciness = document.getElementById('grav-b').value / 100;

    // 1. Draw the physical walls
    ctx.strokeStyle = 'var(--match-green)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    grav.lines.forEach(l => {
        ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
    });

    // Draw the wall currently being dragged by the mouse
    if (grav.isDrawing) {
        ctx.strokeStyle = '#888';
        ctx.beginPath(); ctx.moveTo(grav.startX, grav.startY); ctx.lineTo(grav.tempX, grav.tempY); ctx.stroke();
    }

    // 2. Physics & Collision Loop for the Balls
    grav.balls.forEach(b => {
        b.vy += gravity; // Gravity accelerates the ball downwards
        b.x += b.vx;
        b.y += b.vy;

        // Wall Bounces (Left/Right)
        if (b.x < b.r) { b.x = b.r; b.vx *= -bounciness; }
        if (b.x > w - b.r) { b.x = w - b.r; b.vx *= -bounciness; }

        // The Abyss (If ball falls off the bottom, drop it from the sky again!)
        if (b.y > h + 50) {
            b.y = -10; b.vy = 0; b.vx = (Math.random() - 0.5) * 4;
        }

        // 3. Line Segment Collision Math
        grav.lines.forEach(l => {
            let dx = l.x2 - l.x1;
            let dy = l.y2 - l.y1;
            let len2 = dx * dx + dy * dy;

            // Find the closest mathematical point on the line segment to the ball
            let t = Math.max(0, Math.min(1, ((b.x - l.x1) * dx + (b.y - l.y1) * dy) / len2));
            let projX = l.x1 + t * dx;
            let projY = l.y1 + t * dy;

            let distX = b.x - projX;
            let distY = b.y - projY;
            let dist = Math.hypot(distX, distY);

            // If the distance is less than the radius, it's a collision!
            if (dist < b.r) {
                let nx = distX / dist;
                let ny = distY / dist;
                let vDotN = b.vx * nx + b.vy * ny;

                // Only bounce if the ball is moving *towards* the line
                if (vDotN < 0) {
                    // Vector Reflection Equation
                    b.vx = (b.vx - 2 * vDotN * nx) * bounciness;
                    b.vy = (b.vy - 2 * vDotN * ny) * bounciness;

                    // Push ball out to prevent it getting stuck inside the line
                    b.x += nx * (b.r - dist);
                    b.y += ny * (b.r - dist);

                    // 4. TRIGGER THE SYNTHESIZER!
                    let impactSpeed = Math.abs(vDotN);
                    // Filter out microscopic micro-bounces to prevent MIDI crashing
                    if (impactSpeed > 0.5 && typeof triggerGravNote === "function") {
                        triggerGravNote(b.x, w, impactSpeed);

                        // Draw a collision spark!
                        ctx.beginPath(); ctx.arc(projX, projY, 12, 0, Math.PI * 2);
                        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'; ctx.fill();
                    }
                }
            }
        });

        // 5. Draw the Ball
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fillStyle = 'var(--target-blue)'; ctx.fill();
        ctx.shadowBlur = 10; ctx.shadowColor = 'var(--target-blue)';
    });
}
// Start the physics loop!
gravLoop();

// --- 80s STEREO CHORUS ENGINE ---
function buildChorusCircuit() {
    if (!audioCtx) return;

    // 1. Core routing nodes
    chorus.inputNode = audioCtx.createGain();
    chorus.outputNode = audioCtx.createGain();
    chorus.dryGain = audioCtx.createGain();
    chorus.wetGain = audioCtx.createGain();

    // 2. The Twin Delays (15ms to 30ms is classic chorus territory)
    chorus.delayL = audioCtx.createDelay();
    chorus.delayL.delayTime.value = 0.02; // 20ms
    chorus.delayR = audioCtx.createDelay();
    chorus.delayR.delayTime.value = 0.025; // 25ms (Slightly offset for width)

    // 3. The Modulating LFO
    chorus.lfo = audioCtx.createOscillator();
    chorus.lfo.type = 'sine';
    chorus.lfo.frequency.value = 1.5; // Default speed

    // 4. Phase Inversion (The secret to wide stereo)
    chorus.lfoDepthL = audioCtx.createGain();
    chorus.lfoDepthR = audioCtx.createGain();

    // We wire the LFO to push the left ear forward, and pull the right ear backward!
    chorus.lfo.connect(chorus.lfoDepthL);
    chorus.lfoDepthL.connect(chorus.delayL.delayTime);

    chorus.lfo.connect(chorus.lfoDepthR);
    chorus.lfoDepthR.connect(chorus.delayR.delayTime);

    chorus.lfo.start();

    // 5. Stereo Merger (Puts Left delay in Left ear, Right delay in Right ear)
    chorus.merger = audioCtx.createChannelMerger(2);
    chorus.delayL.connect(chorus.merger, 0, 0); // Channel 0 is Left
    chorus.delayR.connect(chorus.merger, 0, 1); // Channel 1 is Right

    // 6. Final Signal Path Wiring
    chorus.inputNode.connect(chorus.dryGain);
    chorus.inputNode.connect(chorus.delayL);
    chorus.inputNode.connect(chorus.delayR);

    chorus.merger.connect(chorus.wetGain);

    chorus.dryGain.connect(chorus.outputNode);
    chorus.wetGain.connect(chorus.outputNode);

    updateChorusSettings(); // Apply the sliders immediately
}


// --- BITCRUSHER & FUZZ ENGINE ---
function buildCrusherCircuit() {
    if (!audioCtx) return;

    crusher.inputNode = audioCtx.createGain();
    crusher.outputNode = audioCtx.createGain();

    // The WaveShaper nodes
    crusher.bitNode = audioCtx.createWaveShaper();
    crusher.fuzzNode = audioCtx.createWaveShaper();

    // Wire them in series: Input -> Bits -> Fuzz -> Output
    crusher.inputNode.connect(crusher.bitNode);
    crusher.bitNode.connect(crusher.fuzzNode);
    crusher.fuzzNode.connect(crusher.outputNode);

    updateCrusherSettings();
}

// Math for Hard Clipping (Fuzz Overdrive)
function makeFuzzCurve(drive) {
    let n_samples = 44100;
    let curve = new Float32Array(n_samples);
    // Multiply the volume by 'drive', then hard-clamp it between -1 and 1
    for (let i = 0; i < n_samples; ++i) {
        let x = (i * 2) / n_samples - 1;
        curve[i] = Math.max(-1, Math.min(1, x * drive));
    }
    return curve;
}

// Math for Bit Depth Reduction (The "Staircase" effect)
function makeBitCurve(bits) {
    let n_samples = 44100;
    let curve = new Float32Array(n_samples);
    let steps = Math.pow(2, bits); // 16-bit = 65536 steps. 2-bit = 4 steps!

    for (let i = 0; i < n_samples; ++i) {
        let x = (i * 2) / n_samples - 1;
        // Force the smooth wave onto the nearest mathematical "step"
        curve[i] = Math.round(x * steps) / steps;
    }
    return curve;
}

// --- MPC BEAT REPEATER ENGINE ---
function buildStutterCircuit() {
    if (!audioCtx) return;

    stutter.inputNode = audioCtx.createGain();
    stutter.outputNode = audioCtx.createGain();
    stutter.dryGain = audioCtx.createGain();
    stutter.wetGain = audioCtx.createGain();

    // The Trap (Max 2 seconds of memory)
    stutter.delayNode = audioCtx.createDelay(2.0);
    stutter.feedbackGain = audioCtx.createGain();

    // Default state: Mute the stutter, pass the dry audio
    stutter.wetGain.gain.value = 0.0;
    stutter.feedbackGain.gain.value = 0.0;
    stutter.dryGain.gain.value = 1.0;

    // Route the audio into the trap
    stutter.inputNode.connect(stutter.dryGain);
    stutter.inputNode.connect(stutter.delayNode);

    // Create the infinite mirror loop
    stutter.delayNode.connect(stutter.feedbackGain);
    stutter.feedbackGain.connect(stutter.delayNode);

    // Route the trap to the wet output
    stutter.delayNode.connect(stutter.wetGain);

    // Send both dry and wet to the final output
    stutter.dryGain.connect(stutter.outputNode);
    stutter.wetGain.connect(stutter.outputNode);
}

// --- TRANCE GATE ENGINE ---
function buildGateCircuit() {
    if (!audioCtx) return;
    tGate.gainNode = audioCtx.createGain();
    tGate.gainNode.gain.value = 1.0; // Default to full volume
}

// --- LISSAJOUS VECTOR SCOPE ---
function startOscilloscope() {
    // 1. Pointing to YOUR exact canvas ID
    const cvs = document.getElementById('osc-canvas');
    if (!cvs || !analyserL || !analyserR) {
        console.warn("Waiting for audio nodes to build...");
        return; 
    }
    
    const ctx = cvs.getContext('2d');
    const bufferLength = analyserL.frequencyBinCount;
    const dataL = new Uint8Array(bufferLength);
    const dataR = new Uint8Array(bufferLength);

    function draw() {
        requestAnimationFrame(draw);
        analyserL.getByteTimeDomainData(dataL);
        analyserR.getByteTimeDomainData(dataR);

        // Read your existing GAIN slider to make the shapes bigger/smaller!
        const gainSlider = document.getElementById('scope-gain');
        const gain = gainSlider ? parseFloat(gainSlider.value) / 2 : 1;

        // Draw a semi-transparent black background to create "phosphor trails"
        ctx.fillStyle = 'rgba(10, 10, 10, 0.2)'; 
        ctx.fillRect(0, 0, cvs.width, cvs.height);

        ctx.lineWidth = 2;
        ctx.strokeStyle = 'var(--match-green)'; 
        ctx.shadowBlur = 8;
        ctx.shadowColor = 'var(--match-green)';
        ctx.beginPath();

        for (let i = 0; i < bufferLength; i++) {
            // Left ear controls X (Horizontal), Right ear controls Y (Vertical)
            // We apply your gain slider math here to scale the vector from the center
            let normL = ((dataL[i] / 128.0) - 1) * gain; 
            let normR = ((dataR[i] / 128.0) - 1) * gain; 

            const x = (normL + 1) * (cvs.width / 2);
            const y = (-normR + 1) * (cvs.height / 2); // Inverted so positive is up

            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    
    draw(); // Kick off the infinite drawing loop!
}