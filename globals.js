// --- CORE SYNTH CONFIG ---
const CONFIG = [
    { section: "LFO", controls: [{ id: "lfoa", label: "Assign", min: 0, max: 4 }, { id: "lfod", label: "Depth", min: 1, max: 12 }, { id: "lfos", label: "Speed", min: 1, max: 12 }] },
    { section: "Global", controls: [{ id: "port", label: "Porta", min: 0, max: 6 }] },
    { section: "Osc", controls: [{ id: "osct", label: "Type", min: 0, max: 4 }, { id: "osctxt", label: "Textur", min: 1, max: 12 }, { id: "oscmod", label: "Mod", min: 1, max: 12 }] },
    { section: "Filter", controls: [{ id: "fcut", label: "Cutoff", min: 1, max: 12 }, { id: "fres", label: "Reso", min: 1, max: 12 }] },
    { section: "EG", controls: [{ id: "egm", label: "Mix", min: 1, max: 12 }, { id: "ega", label: "A", min: 1, max: 12 }, { id: "egd", label: "D", min: 1, max: 12 }, { id: "egs", label: "S", min: 1, max: 12 }, { id: "egr", label: "R", min: 1, max: 12 }] },
    { section: "Effect", controls: [{ id: "efft", label: "Type", min: 0, max: 4 }, { id: "effd", label: "Depth", min: 1, max: 12 }, { id: "effr", label: "Rate", min: 1, max: 12 }] }
];

const LABELS = { port: ['POLY', 'MONO', 'P1', 'P2', 'P3', 'P4', 'P5'], lfoa: ['OFF', 'AMP', 'FILT', 'PITCH', 'OSC'], osct: ['M-Saw', 'Pulse', 'Sync', 'Ring', 'FM'], efft: ['OFF', 'DELAY', 'PHASE', 'CHORUS', 'DIST'] };

let ccMap = JSON.parse(localStorage.getItem('ref_cc_omnibus')) || { 5: 'port', 102: 'lfoa', 103: 'lfod', 104: 'lfos', 105: 'osct', 106: 'osctxt', 107: 'oscmod', 74: 'fcut', 109: 'fres', 110: 'egm', 111: 'ega', 112: 'egd', 113: 'egs', 114: 'egr', 115: 'efft', 116: 'effd', 117: 'effr' };

// --- GLOBAL STATE ---
let midiOut = null; 
let isLearning = null; 
let isFrozen = false; 
let activeNotes = [];
let currentChordRoot = -1; 
let currentChordQual = '';

// Expansion States
let arp = { on: false, latch: false, notes: [], held: [], index: 0, lastTick: 0 };
let looper = { active: true, loopLength: 0, time: 0, lastTick: 0, tracks: [
    { rec: false, events: [] }, { rec: false, events: [] }, { rec: false, events: [] }, { rec: false, events: [] }
]};
let mod = { lfo2On: false, lfo2Phase: 0, velOn: false };

// Polyphonic Sequencer State
let seq = {
    on: false,
    currentStep: -1,
    lastTick: 0,
    viewTrack: 0, // Which track (0-3) is currently displayed on the grid
    selectedStep: 0, // Which step (0-15) is being edited
    // Generate 4 independent tracks
    tracks: Array.from({length: 4}, () => ({
        playing: true, 
        steps: Array.from({length: 16}, () => ({ active: false, note: 60, cut: 0 }))
    }))
};

// ADSR Canvas States
let envState = 'idle'; let nOnTime = 0; let nOffTime = 0; let rStartLvl = 0;

// Audio Context States
let audioCtx, analyser;

// Music Theory Dictionaries
const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const scaleDict = { 'Major': [0, 2, 4, 5, 7, 9, 11], 'Minor': [0, 2, 3, 5, 7, 8, 10], 'PentMaj': [0, 2, 4, 7, 9], 'PentMin': [0, 3, 5, 7, 10], 'Blues': [0, 3, 5, 6, 7, 10] };
const ghostDict = { 'Major': [0, 4, 7], 'Minor': [0, 3, 7], 'Maj7': [0, 4, 7, 11], 'Min7': [0, 3, 7, 10], 'Dom7': [0, 4, 7, 10] };
const chordDict = { '0,4,7': 'Major', '0,3,7': 'Minor', '0,4,7,11': 'Maj 7', '0,3,7,10': 'Min 7', '0,4,7,10': 'Dom 7', '0,3,6': 'Dim', '0,4,8': 'Aug', '0,5,7': 'Sus 4', '0,2,7': 'Sus 2', '0,7': '5 (Power)' };
const cofOrder = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
// --- FX & AUDIO PIPELINE GLOBALS ---
let micSource, delayNode, feedbackNode, delayMix, convolverNode, verbMix, dryGain;
let fxState = { delay: false, verb: false };

// --- RECORDER & XY PAD GLOBALS ---
let mediaRecorder;
let recordedChunks = [];
let audioDestNode; // Where we capture the sound

let xyState = {
    A: null, // Top-Left preset
    B: null, // Top-Right preset
    C: null, // Bottom-Left preset
    D: null, // Bottom-Right preset
    isDragging: false
};

// --- TURING MACHINE STATE ---
let turing = {
    on: false,
    lastTick: 0,
    currentStep: -1,
    length: 8,
    mutation: 10, // 10% chance to change a note
    sequence: Array(16).fill(60), // Holds the current melody
    mutatedThisStep: false // Flag for the visualizer
};

// --- CUSTOM DRAWABLE LFO STATE ---
let drawLfo = {
    on: false,
    phase: 0, 
    resolution: 100, 
    path: Array(100).fill(0.5), 
    isDrawing: false,
    lastTick: 0,
    lastDrawIndex: -1,
    lastSentCC: -1 // <--- ADD THIS LINE!
};

// --- AUDIO SIDECHAIN STATE ---
let sidechain = {
    on: false,
    smoothedLevel: 0, // Used to create the smooth "release" of the compressor
    lastSentCC: -1
};

// --- VOCAL CONTROLLER STATE ---
let vocalCtrl = {
    on: false,
    lastTick: 0,
    activeNote: -1 // -1 means no note is currently playing
};

// --- WEBCAM THEREMIN STATE ---
let theremin = {
    on: false,
    handsAI: null,
    camera: null,
    lastTick: 0,
    lastLeftCC: -1,
    lastRightCC: -1
};

// --- CELLULAR AUTOMATA STATE ---
let life = {
    on: false,
    width: 16,
    height: 8,
    currentStep: -1,
    lastTick: 0,
    // A 2D array representing 8 rows of 16 columns
    grid: Array.from({length: 8}, () => Array(16).fill(false)) 
};

// --- 3D SPATIALIZER STATE ---
let spatializer = {
    on: false,
    panner: null,
    isDragging: false,
    autoOrbit: false,
    orbitPhase: 0 // Tracks the 360-degree rotation angle
};

// --- GHOST MOTION SEQUENCER STATE ---
let motionSeq = {
    isRecording: false,
    isPlaying: false,
    loopLengthMs: 4000, // Default 4 seconds
    playStart: 0,
    events: [], // Stores { timePct: 0.0-1.0, cc: num, val: num }
    lastTickPct: 0
};

// --- GRAVITY SEQUENCER STATE ---
let grav = {
    balls: [],
    lines: [],
    isDrawing: false,
    startX: 0,
    startY: 0,
    tempX: 0,
    tempY: 0
};

// --- 80s STEREO CHORUS STATE ---
let chorus = {
    on: false,
    inputNode: null,
    dryGain: null,
    wetGain: null,
    delayL: null,
    delayR: null,
    lfo: null,
    lfoDepthL: null,
    lfoDepthR: null,
    merger: null,
    outputNode: null
};

// --- BITCRUSHER & FUZZ STATE ---
let crusher = {
    on: false,
    inputNode: null,
    bitNode: null,
    fuzzNode: null,
    outputNode: null
};

// --- MPC BEAT REPEATER STATE ---
let stutter = {
    inputNode: null,
    outputNode: null,
    delayNode: null,
    feedbackGain: null,
    dryGain: null,
    wetGain: null
};

// --- TRANCE GATE STATE ---
let tGate = {
    on: false,
    gainNode: null,
    steps: Array(16).fill(true), // Array remembering which steps are ON or OFF
    currentStep: -1,
    lastTick: 0
};

// --- EXTERNAL MIDI CLOCK STATE ---
let lastClockTick = 0;
let clockDeltas = []; // Stores the time of the last 24 pulses to calculate a smooth average

// --- LISSAJOUS SCOPE STATE ---
let splitterNode = null;
let analyserL = null;
let analyserR = null;

// --- SYNTHESIA CASCADE STATE ---
let cascade = {
    isPlaying: false,
    speed: 3, // How fast the notes fall
    score: 0,
    fallingNotes: [], // Notes currently on screen
    songQueue: [], // Notes waiting to drop
    hitZoneY: 350, // The physical line they must cross to be hit
    particles: [] // For the explosion effects!
};

// A simple sequence: { pitch: MIDI note, delay: frames to wait before dropping }
const demoSong = [
    { pitch: 48, delay: 60 }, // C3
    { pitch: 52, delay: 60 }, // E3
    { pitch: 55, delay: 60 }, // G3
    { pitch: 59, delay: 60 }, // B3
    { pitch: 60, delay: 60 }, // C4
    { pitch: 59, delay: 60 }, // B3
    { pitch: 55, delay: 60 }, // G3
    { pitch: 52, delay: 60 }  // E3
];

// --- THE REPLICANT STATE ---
let replicant = {
    state: 'idle', // 'idle', 'playing' (ghost's turn), or 'listening' (your turn)
    sequence: [],  // The array of MIDI notes the ghost generated
    playerStep: 0, // Which note you are currently trying to guess
    level: 1
};

// --- SIGHT-READING STATE & MATH ---
let sightReader = {
    isPlaying: false,
    score: 0,
    speed: 2,
    notes: [], // Notes currently scrolling on screen
    frameCount: 0
};

// Maps MIDI notes (C4 to C6) to their physical Y-position on a 200px tall canvas
const trebleMap = {
    60: 160, // C4 (Middle C - Needs Ledger Line)
    62: 145, // D4
    64: 130, // E4 (Bottom Line)
    65: 115, // F4
    67: 100, // G4
    69: 85,  // A4
    71: 70,  // B4 (Middle Line)
    72: 55,  // C5
    74: 40,  // D5
    76: 25,  // E5 (Top Space)
    77: 10   // F5 (Top Line)
};

// --- TIMING TRAINER STATE ---
let timingTrainer = {
    on: false,
    bpm: 100,
    interval: 600, // Milliseconds between beats
    nextBeat: 0
};