<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';

const emit = defineEmits(['toast']);

const props = defineProps({
  videoSrc: {
    type: String,
    default: '/assets/default_video.mp4'
  },
  hideText: {
    type: Boolean,
    default: false
  },
  bottomFade: {
    type: String,
    default: 'cream' // 'cream', 'black', 'none'
  }
});

// Core Scroll Easing & Animation States
const progress = ref(0); // Eased progress (0.0 to 1.0)
const targetProgress = ref(0); // Target scroll depth progress (0.0 to 1.0)
const canvasRef = ref(null);
const containerRef = ref(null);

const isMobileScreen = ref(false);
const checkScreen = () => {
  isMobileScreen.value = typeof window !== 'undefined' && window.innerWidth < 768;
};

// Scroll-locking mechanics to lock user scroll window while video scrubs
const isLocked = ref(false);
let lockedScrollY = 0;

let rafId = null;
let isTicking = false;

// Kinetic Typography & Sections mapping
const isMobileDevice = typeof window !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '');
const compileTotal = ref(isMobileDevice ? 80 : 120);

const scrollSectionHeight = computed(() => {
  const isMobile = isMobileScreen.value || isMobileDevice;
  if (props.videoSrc === '/assets/default_video.mp4') {
    return isMobile ? '150vh' : '200vh'; // Extra compact and responsive first section (glacial ice & strawberry)
  }
  return isMobile ? '300vh' : '380vh'; // Shortened and optimized second section (chocolate swirl)
});
const videoOpacity = computed(() => {
  const t = progress.value;
  const fadeInThreshold = 0.12; // Smooth 12% scroll transition threshold
  return 0.3 + (0.7 * Math.min(1, t / fadeInThreshold));
});
const isVideoLoaded = ref(false);
const isDragging = ref(false);
const currentTimecode = ref('00:00:00');
const videoRatio = ref(16 / 9);
const hasRatio = ref(false);

const videoElementRef = ref(null);
const isVideoLoadedDirect = ref(false);

// Compile Preload HUD States (Maintained as fallback variables)
const isCompiling = ref(false);
const compileCount = ref(0);
const preloadedImages = ref([]); // Stub for compatibility
const showCacheStatus = ref('');

// IndexedDB Multi-Store Configuration
const DB_NAME = 'jessys_scrubber_video_db';
const STORE_NAME_VIDEO = 'video_blobs';
const STORE_NAME_FRAMES = 'video_frames';

// Initialize IndexedDB with multi-store support
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME_VIDEO)) {
        db.createObjectStore(STORE_NAME_VIDEO);
      }
      if (!db.objectStoreNames.contains(STORE_NAME_FRAMES)) {
        db.createObjectStore(STORE_NAME_FRAMES);
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

// Persist the original raw video file in Cache
async function saveVideoToCache(blob) {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME_VIDEO, 'readwrite');
      const store = tx.objectStore(STORE_NAME_VIDEO);
      const request = store.put(blob, 'uploaded_scrub_video_' + props.videoSrc);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Error saving raw video content back down to DB:', err);
  }
}

// Retrieve the original raw video file from Cache
async function getCachedVideo() {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME_VIDEO, 'readonly');
      const store = tx.objectStore(STORE_NAME_VIDEO);
      const request = store.get('uploaded_scrub_video_' + props.videoSrc);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Error fetching cached video blob:', err);
    return null;
  }
}

// Compile custom video into exact keyframes and cache to DB
async function compileVideoToFrames(file) {
  if (!file) return;
  
  isCompiling.value = true;
  compileCount.value = 0;
  preloadedImages.value = [];
  
  emit('toast', {
    text: 'Locking hardware decoder & preloading custom video frames...',
    type: 'info'
  });
  
  const extractorUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = extractorUrl;
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  
  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Codec failed to compile metadata.'));
    });
    
    const duration = video.duration || 6;
    const total = compileTotal.value;
    
    // Setup offscreen canvas to scale and optimize frames
    const scratchCanvas = document.createElement('canvas');
    let videoWidth = video.videoWidth || 1280;
    let videoHeight = video.videoHeight || 720;
    
    // Set video aspect ratio
    const aspect = videoWidth / videoHeight;
    videoRatio.value = aspect;
    hasRatio.value = true;
    
    // Downscale bound cap to optimize storage and maximize render performance (cap to 640px on mobile for 4x memory savings, 1024px on desktop)
    const maxDimension = isMobileDevice ? 640 : 1024;
    if (videoWidth > maxDimension || videoHeight > maxDimension) {
      if (videoWidth > videoHeight) {
        videoHeight = Math.round((videoHeight * maxDimension) / videoWidth);
        videoWidth = maxDimension;
      } else {
        videoWidth = Math.round((videoWidth * maxDimension) / videoHeight);
        videoHeight = maxDimension;
      }
    }
    
    scratchCanvas.width = videoWidth;
    scratchCanvas.height = videoHeight;
    const sCtx = scratchCanvas.getContext('2d');
    
    const db = await initDB();
    
    // Clear old frames
    const clearTx = db.transaction(STORE_NAME_FRAMES, 'readwrite');
    clearTx.objectStore(STORE_NAME_FRAMES).clear();
    await new Promise((res) => { clearTx.oncomplete = res; });
    
    const frameUrls = [];
    const tempImages = [];
    
    // Successive seek extraction
    for (let i = 0; i < total; i++) {
      const targetTime = (i / (total - 1)) * duration;
      video.currentTime = targetTime;
      
      // Wait for play seeked
      await new Promise((resSeek) => {
        video.onseeked = resSeek;
      });
      
      // Paint to scratch, convert to high-performance JPEG
      sCtx.drawImage(video, 0, 0, videoWidth, videoHeight);
      const dataUrl = scratchCanvas.toDataURL('image/jpeg', 0.95);
      
      frameUrls.push(dataUrl);
      
      // Append Image element into memory cache
      const img = new Image();
      img.src = dataUrl;
      tempImages.push(img);
      
      compileCount.value = i + 1;
      
      // Yield execution to keep tab smooth and responsive
      if (i % 8 === 0) {
        await new Promise((res) => setTimeout(res, 0));
      }
    }
    
    // Write ALL frames inside a single concurrent write transaction
    const writeTx = db.transaction(STORE_NAME_FRAMES, 'readwrite');
    const store = writeTx.objectStore(STORE_NAME_FRAMES);
    for (let i = 0; i < total; i++) {
      store.put(frameUrls[i], `frame_${i}`);
    }
    
    await new Promise((resolve, reject) => {
      writeTx.oncomplete = resolve;
      writeTx.onerror = () => reject(writeTx.error);
    });
    
    // Save original video blob too for reconstruction backups
    await saveVideoToCache(file);
    
    // Successfully compiled custom video, save flag to localStorage
    localStorage.setItem('scrubber_has_custom_video_' + props.videoSrc, 'true');
    localStorage.setItem('scrubber_compile_total_' + props.videoSrc, total.toString());
    
    preloadedImages.value = tempImages;
    isCompiling.value = false;
    isVideoLoaded.value = true;
    
    emit('toast', {
      text: 'Hollywood-style frame stream preloaded successfully!',
      type: 'success'
    });
    
    drawFrame();
  } catch (error) {
    console.error('Frame compile error:', error);
    isCompiling.value = false;
    emit('toast', {
      text: 'Error loading or compiling video. Verify file format or codec!',
      type: 'error'
    });
  } finally {
    URL.revokeObjectURL(extractorUrl);
  }
}

// Automatically restore preloaded video cache from IndexedDB on startup
async function tryRestoreFromCache() {
  try {
    const hasCustomVideo = localStorage.getItem('scrubber_has_custom_video_' + props.videoSrc) === 'true';
    if (!hasCustomVideo) {
      console.log('No custom video has been flagged in cache for ' + props.videoSrc);
      return false;
    }
    
    const cachedVideoBlob = await getCachedVideo();
    if (cachedVideoBlob && videoElementRef.value) {
      const objectUrl = URL.createObjectURL(cachedVideoBlob);
      videoElementRef.value.src = objectUrl;
      videoElementRef.value.load();
      isVideoLoadedDirect.value = true;
      isVideoLoaded.value = true;
      
      emit('toast', {
        text: 'Custom slow-motion video loaded successfully from cache!',
        type: 'success'
      });
      return true;
    }
  } catch (err) {
    console.warn('Fail to restore keyframes cache:', err);
    localStorage.removeItem('scrubber_has_custom_video_' + props.videoSrc);
  }
  return false;
}

// Wipe cache database clean and restore procedural falls
async function clearAllCachedDataDirect() {
  try {
    const db = await initDB();
    const tx1 = db.transaction(STORE_NAME_VIDEO, 'readwrite');
    tx1.objectStore(STORE_NAME_VIDEO).delete('uploaded_scrub_video_' + props.videoSrc);
    const tx2 = db.transaction(STORE_NAME_FRAMES, 'readwrite');
    tx2.objectStore(STORE_NAME_FRAMES).clear();
    
    // Clear local storage flag
    localStorage.removeItem('scrubber_has_custom_video_' + props.videoSrc);
    
    preloadedImages.value = [];
    isVideoLoaded.value = true;
    isVideoLoadedDirect.value = true;
    
    if (videoElementRef.value) {
      videoElementRef.value.src = props.videoSrc;
      videoElementRef.value.load();
    }
    
    progress.value = 0;
    targetProgress.value = 0;
    isLocked.value = false;
    
    emit('toast', {
      text: 'Visual cache cleared. Returned back to default cinematic loop.',
      type: 'info'
    });
    
    setTimeout(() => {
      drawFrame();
    }, 100);
  } catch (e) {
    console.error('Failed clearing database:', e);
  }
}

// Drop / picker handlers
async function handleVideoFile(file) {
  if (!file) return;
  if (!file.type.startsWith('video/')) {
    alert('Please choose or drop a valid video file! 🍒');
    return;
  }
  
  emit('toast', {
    text: 'Loading your custom video instantly...',
    type: 'info'
  });

  try {
    if (videoElementRef.value) {
      const url = URL.createObjectURL(file);
      videoElementRef.value.src = url;
      videoElementRef.value.load();
      isVideoLoadedDirect.value = true;
      isVideoLoaded.value = true;
      
      // Save original video blob to cache in background
      await saveVideoToCache(file);
      localStorage.setItem('scrubber_has_custom_video_' + props.videoSrc, 'true');
      
      emit('toast', {
        text: 'Custom slow-motion video loaded successfully!',
        type: 'success'
      });
      
      setTimeout(() => {
        drawFrame();
      }, 100);
    }
  } catch (e) {
    console.error('Failed to load local video:', e);
    emit('toast', {
      text: 'Could not load your video file. Please check format or codec!',
      type: 'error'
    });
  }
}

function onFileSelected(e) {
  const file = e.target.files?.[0];
  handleVideoFile(file);
}

function onDrop(e) {
  isDragging.value = false;
  const file = e.dataTransfer?.files?.[0];
  handleVideoFile(file);
}

// Cinematic display text sections
const textOverlays = [
  { 
    title: 'GLACIAL ICE', 
    subtitle: 'Deep Sub-Zero Freeze Cold', 
    badge: '01', 
    desc: 'Pure frozen crystals paired with deep atmospheric vapor claddings for an ultra-chilly, sweat-free summer retreat.'
  },
  { 
    title: 'VAPOR MIST', 
    subtitle: 'Dense Condensation Lock', 
    badge: '02', 
    desc: 'Thick cascades of sweet air conditioning fog that seal premium flavors inside our famous molten waffles and hot crepes.'
  },
  { 
    title: 'SWEET STRAWBERRY', 
    subtitle: 'Lebanese Mountain Selection', 
    badge: '03', 
    desc: 'Only the highest grade sun-kissed strawberries, picked fresh at dawn from fertile northern Lebanese valleys.'
  },
  { 
    title: 'VELVET SWIRL', 
    subtitle: 'Gourmet Clotted Cream Peaks', 
    badge: '04', 
    desc: 'Generous mountains of local clotted cream (ashta) crowned with golden mountain honey and rich melted Belgian chocolate.'
  }
];

// Computes text overlays dynamically depending on whether it's the first strawberry section
const currentOverlays = computed(() => {
  if (isMobileScreen.value) {
    return textOverlays;
  }
  if (props.videoSrc === '/assets/default_video.mp4') {
    return [
      { 
        title: 'GLACIAL ICE', 
        subtitle: 'Deep Sub-Zero Freeze Cold', 
        badge: '01', 
        desc: 'Pure frozen crystals paired with deep atmospheric vapor claddings for an ultra-chilly, sweat-free summer retreat.'
      },
      { 
        title: 'SWEET STRAWBERRY', 
        subtitle: 'Lebanese Mountain Selection', 
        badge: '02', 
        desc: 'Only the highest grade sun-kissed strawberries, picked fresh at dawn from fertile northern Lebanese valleys.'
      }
    ];
  }
  return textOverlays;
});

// Returns the active scene descriptor string
const currentSceneLabel = computed(() => {
  const p = progress.value;
  if (isVideoLoaded.value) {
    return `Fluid Frame Render: ${(p * 100).toFixed(0)}%`;
  }
  if (isMobileScreen.value) {
    if (p < 0.25) return '❄️ Glacial Ice Cubes & White Vapor';
    if (p < 0.50) return '🍓 Symphony of Falling Strawberries';
    if (p < 0.75) return '🌰 Premium Chocolate & Hazelnut Pouring';
    return '🍦 Sweet Pink Strawberry Swirl Cream';
  }
  if (currentOverlays.value.length === 2) {
    if (p < 0.5) return '❄️ Glacial Ice Cubes & White Vapor';
    return '🍓 Symphony of Falling Strawberries';
  }
  if (p < 0.25) return '❄️ Glacial Ice Cubes & White Vapor';
  if (p < 0.50) return '🍓 Symphony of Falling Strawberries';
  if (p < 0.75) return '🌰 Premium Chocolate & Hazelnut Pouring';
  return '🍦 Sweet Pink Strawberry Swirl Cream';
});

const boxStyle = computed(() => {
  const ratio = videoRatio.value;
  if (!isVideoLoaded.value) {
    return {
      aspectRatio: '1.777',
      width: 'min(100%, 1024px)',
      maxHeight: '80vh',
    };
  }
  if (ratio < 1) {
    return {
      aspectRatio: `${ratio}`,
      height: '85vh',
      maxHeight: '85vh',
      width: `calc(85vh * ${ratio})`,
      maxWidth: '100vw',
    };
  } else {
    return {
      aspectRatio: `${ratio}`,
      width: 'min(100%, 1024px)',
      maxHeight: '85vh',
    };
  }
});

// Clean non-overlapping cinematic segments
const textIntervals = [
  { center: 0.18, start: 0.06, end: 0.30 }, // First (right)
  { center: 0.44, start: 0.32, end: 0.56 }, // Second (left)
  { center: 0.70, start: 0.58, end: 0.82 }, // Third (right)
  { center: 0.90, start: 0.82, end: 0.98 }  // Fourth (left)
];

const currentIntervals = computed(() => {
  if (isMobileScreen.value) {
    return textIntervals;
  }
  if (currentOverlays.value.length === 2) {
    return [
      { center: 0.28, start: 0.08, end: 0.48 }, // Glacial Ice (right)
      { center: 0.72, start: 0.52, end: 0.92 }  // Sweet Strawberry (left)
    ];
  }
  return textIntervals;
});

// Opacity and kinetic offset animation states for the text slides with side-slide transition
function getOverlayStyle(index) {
  const interval = currentIntervals.value[index];
  const p = progress.value;
  let opacity = 0;
  
  if (p >= interval.start && p <= interval.end) {
    if (p < interval.center) {
      // Linear fade in
      opacity = (p - interval.start) / (interval.center - interval.start);
    } else {
      // Linear fade out
      opacity = (interval.end - p) / (interval.end - interval.center);
    }
    // Apply smooth sinusoidal ease in/out
    opacity = Math.sin(opacity * Math.PI / 2);
  }
  
  // Subtle vertical kinetic lift
  const relativeDistance = p - interval.center;
  const translateY = relativeDistance * -150; // smooth physical motion
  
  // Slide animation: slide in from left/right and fade
  const isLeft = index % 2 === 1;
  const slideFrom = isLeft ? -100 : 100;
  const translateX = (1 - opacity) * slideFrom;
  
  return {
    opacity: opacity,
    transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${0.95 + 0.05 * opacity})`,
    pointerEvents: opacity > 0.15 ? 'auto' : 'none',
    display: opacity === 0 ? 'none' : 'flex'
  };
}

// Watch progress and update ticking timecodes
watch(progress, (newVal) => {
  const totalDuration = 6; // Standardized cinematic 6-second scale
  const currentTotalSec = newVal * totalDuration;
  const min = Math.floor(currentTotalSec / 60);
  const sec = Math.floor(currentTotalSec % 60);
  const frame = Math.floor((currentTotalSec % 1) * 60);
  currentTimecode.value = `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}:${frame.toString().padStart(2, '0')}`;
});

// DRAW THE ACTIVE FRAME onto high-performance 2D Canvas / Native Video
let pendingSeekTime = null;

function onSeeked() {
  const video = videoElementRef.value;
  if (video && pendingSeekTime !== null) {
    const target = pendingSeekTime;
    pendingSeekTime = null;
    const duration = video.duration || 6;
    const boundedTarget = Math.max(0, Math.min(duration - 0.05, target));
    if (Math.abs(video.currentTime - boundedTarget) > 0.01) {
      video.currentTime = boundedTarget;
    }
  }
}

function drawFrame() {
  const video = videoElementRef.value;
  const t = progress.value;

  if (video && isVideoLoadedDirect.value) {
    const duration = video.duration || 6;
    const targetTime = Math.max(0, Math.min(duration - 0.05, t * duration));
    
    // Smooth, non-congested target rendering using double-buffered seek locks
    if (!video.seeking) {
      if (Math.abs(video.currentTime - targetTime) > 0.01) {
        video.currentTime = targetTime;
      }
    } else {
      pendingSeekTime = targetTime;
    }
    return;
  }

  // Draw procedural fallback animations to Canvas when video is loading/staged
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = rect.width;
  const h = rect.height;

  if (w <= 0 || h <= 0 || isNaN(w) || isNaN(h)) return;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#18181b'; 
  ctx.fillRect(0, 0, w, h);

  // Calculate high-fidelity smooth fade-in
  const fadeInThreshold = 0.10;
  const opacity = 0.3 + (0.7 * Math.min(1, t / fadeInThreshold));

  ctx.save();
  ctx.globalAlpha = opacity;

  // Beautiful Procedural Falls (FALLBACK ANIMATION SHOWN ON FRESH VISITS)
  if (t < 0.25) {
    const lt = t / 0.25;
    renderIceCubes(ctx, w, h, lt);
  } else if (t < 0.50) {
    const lt = (t - 0.25) / 0.25;
    renderFallingStrawberries(ctx, w, h, lt);
  } else if (t < 0.75) {
    const lt = (t - 0.50) / 0.25;
    renderChocolateHazelnuts(ctx, w, h, lt);
  } else {
    const lt = (t - 0.75) / 0.25;
    renderPinkVelvetSwirls(ctx, w, h, lt);
  }

  ctx.restore();
}

// ---------------- PROCEDURAL CINEMATIC FALLBACK RENDERS ----------------
function drawStrawberry(ctx, cx, cy, scale, angle) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.scale(scale, scale);

  ctx.beginPath();
  ctx.moveTo(0, -30);
  ctx.bezierCurveTo(24, -30, 28, -2, 0, 32);
  ctx.bezierCurveTo(-28, -2, -24, -30, 0, -30);
  ctx.closePath();

  const berryGrad = ctx.createRadialGradient(-8, -12, 4, 0, 0, 36);
  berryGrad.addColorStop(0, '#ff4b6e');
  berryGrad.addColorStop(0.3, '#ff1a40');
  berryGrad.addColorStop(0.8, '#dd0022');
  berryGrad.addColorStop(1, '#7a000e');
  ctx.fillStyle = berryGrad;
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(-10, -14, 6, 12, Math.PI / 6, 0, Math.PI * 2);
  const gloss = ctx.createLinearGradient(-16, -20, -4, -8);
  gloss.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
  gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gloss;
  ctx.fill();

  ctx.fillStyle = '#10b981';
  ctx.beginPath();
  ctx.moveTo(0, -30);
  ctx.quadraticCurveTo(0, -42, 0, -46);
  ctx.quadraticCurveTo(6, -38, 4, -28);
  ctx.lineTo(-4, -28);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#fee33c';
  const seedRows = [
    { y: -18, xList: [-12, -4, 4, 12] },
    { y: -10, xList: [-16, -8, 0, 8, 16] },
    { y: -2, xList: [-14, -6, 6, 14] },
    { y: 6, xList: [-10, -2, 8] }
  ];

  seedRows.forEach(row => {
    row.xList.forEach(sx => {
      ctx.save();
      ctx.translate(sx, row.y);
      ctx.beginPath();
      ctx.ellipse(0, 0, 1, 1.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  });

  ctx.restore();
}

function drawIceCube(ctx, cx, cy, size, angle) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);

  const hs = size / 2;
  ctx.beginPath();
  ctx.rect(-hs, -hs, size, size);
  ctx.closePath();

  const cubeGrad = ctx.createLinearGradient(-hs, -hs, hs, hs);
  cubeGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  cubeGrad.addColorStop(0.3, 'rgba(210, 240, 255, 0.5)');
  cubeGrad.addColorStop(0.7, 'rgba(150, 220, 255, 0.25)');
  cubeGrad.addColorStop(1, 'rgba(80, 180, 255, 0.45)');
  ctx.fillStyle = cubeGrad;
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
}

function drawSteamFume(ctx, w, h, x, y, size, opacity) {
  ctx.save();
  const safeOpacity = isNaN(opacity) || typeof opacity !== 'number' ? 0.25 : Math.max(0, Math.min(1, opacity));
  const safeSize = isNaN(size) || typeof size !== 'number' || size <= 0 ? 50 : size;
  const safeX = isNaN(x) || typeof x !== 'number' ? 0 : x;
  const safeY = isNaN(y) || typeof y !== 'number' ? 0 : y;

  const grad = ctx.createRadialGradient(safeX, safeY, 0, safeX, safeY, safeSize);
  grad.addColorStop(0, `rgba(230, 235, 245, ${safeOpacity})`);
  grad.addColorStop(0.4, `rgba(220, 225, 235, ${safeOpacity * 0.6})`);
  grad.addColorStop(1, 'rgba(220, 225, 235, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(safeX, safeY, safeSize, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHazelnut(ctx, cx, cy, size, angle) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);

  ctx.beginPath();
  ctx.arc(0, 4, size * 0.9, 0, Math.PI * 2);
  const nutGrad = ctx.createRadialGradient(-size * 0.3, -size * 0.3, size * 0.1, 0, 0, size);
  nutGrad.addColorStop(0, '#f2ca7f');
  nutGrad.addColorStop(0.5, '#c58535');
  nutGrad.addColorStop(0.85, '#854d14');
  nutGrad.addColorStop(1, '#422204');
  ctx.fillStyle = nutGrad;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-size * 0.4, -size * 0.4);
  ctx.bezierCurveTo(0, -size * 1.1, size * 0.1, -size * 1.1, size * 0.4, -size * 0.4);
  ctx.closePath();
  ctx.fillStyle = '#f8e4bc';
  ctx.fill();

  ctx.restore();
}

function renderIceCubes(ctx, w, h, lt) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#02050c');
  grad.addColorStop(0.5, '#051221');
  grad.addColorStop(1, '#010307');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 12; i++) {
    const seed = i * 22.3;
    const x = (w * (i / 11)) + Math.sin(lt * 3.5 + seed) * 35;
    const y = h * 0.85 - (lt * h * 0.5) + Math.cos(lt * 2 + seed) * 20;
    const size = 95 + (i % 3) * 30;
    const opacity = 0.24 * Math.sin(Math.PI * lt) * (1 - y / h);
    drawSteamFume(ctx, w, h, x, y, size, opacity);
  }

  const count = 6;
  for (let j = 0; j < count; j++) {
    const seed = j * 87.5;
    const startX = w * (0.15 + (j / (count - 1)) * 0.7);
    const scrollOffset = lt * h * 1.25;
    const x = startX + Math.sin(lt * 4 + seed) * 30;
    const y = -100 + scrollOffset * (1.0 + (j % 3) * 0.1);
    const size = 48 + (j % 3) * 10;
    const angle = lt * 5.2 + seed;

    if (y > -size && y < h + size) {
      drawIceCube(ctx, x, y, size, angle);
    }
  }
}

function renderFallingStrawberries(ctx, w, h, lt) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#06010a');
  grad.addColorStop(0.5, '#20051e');
  grad.addColorStop(1, '#050008');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 12; i++) {
    const seed = i * 44.9;
    const x = (w * (i / 11)) + Math.cos(lt * 4 + seed) * 40;
    const y = h * 0.95 - (lt * h * 0.7) + Math.sin(lt * 3 + seed) * 30;
    const size = 110 + (i % 3) * 30;
    const opacity = 0.28 * Math.sin(Math.PI * lt);
    drawSteamFume(ctx, w, h, x, y + 10, size, opacity);
  }

  const count = 7;
  for (let j = 0; j < count; j++) {
    const seed = j * 39.4;
    const startX = w * (0.15 + (j / (count - 1)) * 0.7);
    const scrollOffset = lt * h * 1.35;
    const x = startX + Math.sin(lt * 5 + seed) * 35;
    const y = -120 + scrollOffset * (1.1 + (j % 3) * 0.08);
    const scale = 0.72 + (j % 3) * 0.16;
    const angle = lt * 4.4 + seed;

    if (y > -80 && y < h + 80) {
      drawStrawberry(ctx, x, y, scale, angle);
    }
  }
}

function renderChocolateHazelnuts(ctx, w, h, lt) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#100501');
  grad.addColorStop(0.5, '#2e1104');
  grad.addColorStop(1, '#0a0300');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const streamX = w * 0.5 + Math.sin(lt * Math.PI) * 35;
  const streamW = 110 + Math.sin(lt * 4) * 12;
  
  const streamGrad = ctx.createLinearGradient(streamX - streamW, 0, streamX + streamW, 0);
  streamGrad.addColorStop(0, '#1b0802');
  streamGrad.addColorStop(0.35, '#3e1708');
  streamGrad.addColorStop(0.5, '#2b0e03');
  streamGrad.addColorStop(0.65, '#3e1708');
  streamGrad.addColorStop(1, '#1b0802');
  
  ctx.fillStyle = streamGrad;
  ctx.fillRect(streamX - streamW, 0, streamW * 2, h);

  const nutCount = 5;
  for (let j = 0; j < nutCount; j++) {
    const seed = j * 54.1;
    const startX = w * (0.18 + (j / (nutCount - 1)) * 0.64);
    const scrollOffset = lt * h * 1.35;
    const x = startX + Math.sin(lt * 6 + seed) * 30;
    const y = -90 + scrollOffset * (1.0 + (j % 2) * 0.1);
    const size = 16 + (j % 2) * 4;
    const angle = lt * 5.5 + seed;

    if (y > -size && y < h + size) {
      drawHazelnut(ctx, x, y, size, angle);
    }
  }
}

function renderPinkVelvetSwirls(ctx, w, h, lt) {
  const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
  bgGrad.addColorStop(0, '#ffd1d6');
  bgGrad.addColorStop(0.5, '#fb7185');
  bgGrad.addColorStop(1, '#be1c3c');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  for (let wave = 0; wave < 3; wave++) {
    ctx.save();
    const speed = 1.0 + wave * 0.3;
    const yOffset = h * 0.35 + wave * 85;
    const amp = 30 + wave * 8;
    const freq = 0.005 + wave * 0.001;

    const colors = [
      'rgba(255, 245, 247, 0.95)',
      'rgba(255, 218, 224, 0.9)',
      'rgba(251, 113, 133, 0.85)'
    ];
    ctx.fillStyle = colors[wave];

    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w + 10; x += 10) {
      const y = yOffset + Math.sin(x * freq + lt * 4.5 * speed) * amp + Math.cos(x * 0.003 + lt * 2.1) * 18;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  const bCoords = [
    { px: 0.22, py: 0.45, r: 0.8, a: 0.4, seed: 12 },
    { px: 0.52, py: 0.6, r: 0.98, a: -0.2, seed: 44 },
    { px: 0.78, py: 0.5, r: 0.88, a: 0.6, seed: 89 }
  ];

  bCoords.forEach(b => {
    const cx = w * b.px + Math.sin(lt * 3 + b.seed) * 18;
    const cy = h * b.py + Math.cos(lt * 4.5 + b.seed) * 12;
    const angle = b.a + Math.sin(lt * 2 + b.seed) * 0.1;
    drawStrawberry(ctx, cx, cy, b.r, angle);
  });
}

// Sticky Centering container scroll bound calculations
// Natural, non-blocking scroll progress mapping
function handleScroll() {
  if (!containerRef.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  const screenHeight = window.innerHeight;

  const totalScrollableHeight = rect.height - screenHeight;
  if (totalScrollableHeight <= 0) return;

  // Compute progress of scroll through this beautiful 400vh section
  const rawProgress = -rect.top / totalScrollableHeight;
  targetProgress.value = Math.max(0, Math.min(1, rawProgress));

  if (!isTicking) {
    isTicking = true;
    tick();
  }
}

// Elastic viewport smoothing callbacks
function tick() {
  const diff = targetProgress.value - progress.value;
  if (Math.abs(diff) > 0.0001) {
    // Highly responsive snappy feedback instead of heavy laggy drift
    progress.value += diff * (isMobileDevice ? 0.16 : 0.12);
    drawFrame();
    rafId = requestAnimationFrame(tick);
  } else {
    progress.value = targetProgress.value;
    drawFrame();
    isTicking = false;
  }
}

function handleResize() {
  checkScreen();
  drawFrame();
}

const fileInputRef = ref(null);
function triggerFileInput() {
  fileInputRef.value?.click();
}

// Compile beautiful, slow-motion client-side morphing liquid flow
async function compileProceduralLiquidToFrames() {
  isCompiling.value = true;
  compileCount.value = 0;
  preloadedImages.value = [];
  showCacheStatus.value = 'DOWNLOADING_DEFAULT';

  emit('toast', {
    text: 'Compiling premium slow-motion Cosmic Liquid stream...',
    type: 'info'
  });

  try {
    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = 1024;
    renderCanvas.height = 576;
    const renderCtx = renderCanvas.getContext('2d');
    if (!renderCtx) {
      throw new Error('Could not initialize 2D context.');
    }

    const total = compileTotal.value;
    const db = await initDB();

    // Clear old frames
    const clearTx = db.transaction(STORE_NAME_FRAMES, 'readwrite');
    clearTx.objectStore(STORE_NAME_FRAMES).clear();
    await new Promise((res) => { clearTx.oncomplete = res; });

    const frameUrls = [];
    const tempImages = [];

    for (let i = 0; i < total; i++) {
      const t = i / (total - 1); // progress 0 to 1

      // Clear background
      renderCtx.fillStyle = '#0a0a0c';
      renderCtx.fillRect(0, 0, 1024, 576);

      // Morphing centers with layered mathematical ratios
      const cx1 = 1024 * (0.5 + 0.22 * Math.sin(t * Math.PI * 2));
      const cy1 = 576 * (0.5 + 0.16 * Math.cos(t * Math.PI * 4));

      const cx2 = 1024 * (0.5 + 0.28 * Math.cos(t * Math.PI * 2 + Math.PI / 3));
      const cy2 = 576 * (0.5 + 0.18 * Math.sin(t * Math.PI * 3));

      const cx3 = 1024 * (0.5 + 0.14 * Math.sin(t * Math.PI * 5 + Math.PI / 2));
      const cy3 = 576 * (0.5 + 0.24 * Math.cos(t * Math.PI * 2 + Math.PI / 4));

      // Gaseous Rose glow (Strawberry juice style)
      const grad1 = renderCtx.createRadialGradient(cx1, cy1, 10, cx1, cy1, 650);
      grad1.addColorStop(0, 'rgba(244, 63, 94, 0.45)'); // Rose-500
      grad1.addColorStop(0.4, 'rgba(244, 63, 94, 0.08)');
      grad1.addColorStop(1, 'rgba(0, 0, 0, 0)');
      renderCtx.fillStyle = grad1;
      renderCtx.beginPath();
      renderCtx.arc(cx1, cy1, 650, 0, Math.PI * 2);
      renderCtx.fill();

      // Smooth Indigo glow (Ice/Vapor style)
      const grad2 = renderCtx.createRadialGradient(cx2, cy2, 10, cx2, cy2, 700);
      grad2.addColorStop(0, 'rgba(99, 102, 241, 0.42)'); // Indigo-500
      grad2.addColorStop(0.5, 'rgba(139, 92, 246, 0.07)'); // Violet-550
      grad2.addColorStop(1, 'rgba(0, 0, 0, 0)');
      renderCtx.fillStyle = grad2;
      renderCtx.beginPath();
      renderCtx.arc(cx2, cy2, 700, 0, Math.PI * 2);
      renderCtx.fill();

      // Accent emerald/teal breeze (Ashta style)
      const grad3 = renderCtx.createRadialGradient(cx3, cy3, 5, cx3, cy3, 400);
      grad3.addColorStop(0, 'rgba(20, 184, 166, 0.25)'); // Teal-500
      grad3.addColorStop(0.5, 'rgba(20, 184, 166, 0.02)');
      grad3.addColorStop(1, 'rgba(0, 0, 0, 0)');
      renderCtx.fillStyle = grad3;
      renderCtx.beginPath();
      renderCtx.arc(cx3, cy3, 400, 0, Math.PI * 2);
      renderCtx.fill();

      // Fine mesh waves for brutalist luxury look
      renderCtx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
      renderCtx.lineWidth = 1;
      for (let k = 0; k < 4; k++) {
        renderCtx.beginPath();
        for (let x = 0; x < 1024; x += 25) {
          const y = 288 + Math.sin((x / 1024) * Math.PI * 2 + t * Math.PI * 3 + k) * 50 + Math.cos((x / 1024) * Math.PI * 3.5 - t * Math.PI * 2.5) * 20;
          if (x === 0) renderCtx.moveTo(x, y);
          else renderCtx.lineTo(x, y);
        }
        renderCtx.stroke();
      }

      // Ambient floating particle dust
      renderCtx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      for (let p = 0; p < 10; p++) {
        const px = (1024 * (0.2 + 0.6 * Math.sin(t * Math.PI * 1.2 + p * 20))) % 1024;
        const py = (576 * (0.25 + 0.5 * Math.cos(t * Math.PI * 0.7 + p * 40))) % 576;
        renderCtx.beginPath();
        renderCtx.arc(px, py, 1.2 + 0.8 * Math.sin(t * Math.PI * 4 + p), 0, Math.PI * 2);
        renderCtx.fill();
      }

      const frameDataUrl = renderCanvas.toDataURL('image/jpeg', 0.95);
      frameUrls.push(frameDataUrl);

      const img = new Image();
      img.src = frameDataUrl;
      tempImages.push(img);

      compileCount.value = i + 1;

      // Yield event loop to keep page smooth
      if (i % 8 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    // Write ALL frames inside a single write transaction
    const writeTx = db.transaction(STORE_NAME_FRAMES, 'readwrite');
    const store = writeTx.objectStore(STORE_NAME_FRAMES);
    for (let i = 0; i < total; i++) {
      store.put(frameUrls[i], `frame_${i}`);
    }

    await new Promise((resolve, reject) => {
      writeTx.oncomplete = resolve;
      writeTx.onerror = () => reject(writeTx.error);
    });

    preloadedImages.value = tempImages;
    videoRatio.value = 1024 / 576;
    hasRatio.value = true;
    isVideoLoaded.value = true;
    isCompiling.value = false;
    showCacheStatus.value = '';

    emit('toast', {
      text: 'Slow-motion Cosmic Liquid compiled and saved successfully!',
      type: 'success'
    });

    drawFrame();
  } catch (err) {
    console.error('Procedural stream compilation failed:', err);
    isCompiling.value = false;
    showCacheStatus.value = '';
  }
}

onMounted(async () => {
  checkScreen();
  // Clean up legacy global cache flag if present to avoid cross-contamination
  if (localStorage.getItem('scrubber_has_custom_video') !== null) {
    localStorage.removeItem('scrubber_has_custom_video');
  }

  // Listen for scroll and resize
  window.addEventListener('scroll', handleScroll, { passive: true });
  window.addEventListener('resize', handleResize);
  
  if (!isTicking) {
    isTicking = true;
    tick();
  }
  
  // Try to restore custom video from cache first
  const restored = await tryRestoreFromCache();
  if (!restored) {
    // Direct load of the default local video file
    if (videoElementRef.value) {
      videoElementRef.value.src = props.videoSrc;
      videoElementRef.value.load();
      isVideoLoadedDirect.value = true;
      isVideoLoaded.value = true;
      console.log('Default slow-motion loop loaded: ' + props.videoSrc);
    }
  }

  // Force draw initial frame
  setTimeout(() => {
    drawFrame();
  }, 150);
});

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll);
  window.removeEventListener('resize', handleResize);
  if (rafId) cancelAnimationFrame(rafId);
});
</script>

<template>
  <!-- Beautiful, full-screen viewport boundary with no empty spaces to blend precisely with homepage -->
  <div 
    ref="containerRef" 
    id="scroll-scrubber-section" 
    class="relative w-full bg-stone-950"
    :style="{ height: scrollSectionHeight }"
    @dragover.prevent="isDragging = true"
    @dragenter.prevent="isDragging = true"
    @dragleave.prevent="isDragging = false"
    @drop.prevent="onDrop"
  >
    <!-- Drag Over overlay to visually welcome custom video drops -->
    <div 
      v-if="isDragging" 
      class="absolute inset-0 bg-[#863d96]/90 backdrop-blur-md z-50 flex flex-col items-center justify-center p-8 border-4 border-dashed border-[#fee33c] text-white transition-all duration-300 pointer-events-none"
    >
      <span class="material-symbols-outlined text-6xl animate-bounce mb-3 text-[#fee33c]">movie</span>
      <h3 class="font-heading font-black text-xl">Drop your cocktail video now!</h3>
      <p class="text-xs text-white/80 mt-1">We will compile and partition it securely</p>
    </div>

    <!-- MAIN IMMERSIVE CHASSIS STICKY STAGE -->
    <div class="sticky top-0 h-screen w-full overflow-hidden bg-transparent z-10 flex flex-col items-center justify-center select-none">
      
      <!-- EXACT VIEWPORT STRETCHER SHELL WITH GRID AND TEXT BOUNDS -->
      <div 
        id="video-scroll-box" 
        class="relative w-full h-full bg-black flex flex-col z-10"
      >
        
        <!-- NATIVE VIDEO SCROLL SCRUBBER -->
        <video
          ref="videoElementRef"
          aria-hidden="true"
          class="w-full h-full object-cover select-none bg-black pointer-events-none absolute inset-0 z-0 transition-opacity duration-150"
          muted
          playsinline
          webkit-playsinline
          preload="auto"
          :style="{ 
            display: 'block', 
            opacity: videoOpacity,
            maskImage: bottomFade === 'none'
              ? 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 12%, rgba(0,0,0,1) 100%)'
              : 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 12%, rgba(0,0,0,1) 88%, rgba(0,0,0,0) 100%)',
            webkitMaskImage: bottomFade === 'none'
              ? 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 12%, rgba(0,0,0,1) 100%)'
              : 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 12%, rgba(0,0,0,1) 88%, rgba(0,0,0,0) 100%)'
          }"
          @seeked="onSeeked"
        ></video>

        <!-- FLUID CANVAS: DRAWS PROCEDURAL FALLBACKS DYNAMICALLY WHEN VIDEO IS LOADING -->
        <canvas 
          v-show="!isVideoLoadedDirect"
          ref="canvasRef" 
          class="w-full h-full object-cover select-none bg-black pointer-events-none absolute inset-0 z-0"
          :style="{
            maskImage: bottomFade === 'none'
              ? 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 12%, rgba(0,0,0,1) 100%)'
              : 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 12%, rgba(0,0,0,1) 88%, rgba(0,0,0,0) 100%)',
            webkitMaskImage: bottomFade === 'none'
              ? 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 12%, rgba(0,0,0,1) 100%)'
              : 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 12%, rgba(0,0,0,1) 88%, rgba(0,0,0,0) 100%)'
          }"
        ></canvas>

        <!-- CINEMATIC GRID & SCANLINE INTERFERENCE PATTERN -->
        <div class="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.06)_1.5px,transparent_1.5px)] [background-size:20px_20px] pointer-events-none opacity-60 z-10"></div>
        <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 pointer-events-none z-10"></div>

        <!-- ELEGANT ULTRA-SOFT BORDER FADE OVERLAYS: Blends the sharp dark video block transitions seamlessly with Jessy Juice's warm cream background #fffdeb -->
        <div class="absolute top-0 left-0 right-0 h-3 bg-gradient-to-b from-[#fffdeb] to-transparent z-25 pointer-events-none"></div>
        <div v-if="bottomFade === 'cream'" class="absolute bottom-0 left-0 right-0 h-3 bg-gradient-to-t from-[#fffdeb] to-transparent z-25 pointer-events-none"></div>
        <div v-else-if="bottomFade === 'black'" class="absolute bottom-0 left-0 right-0 h-3 bg-gradient-to-t from-black to-transparent z-25 pointer-events-none"></div>

        <!-- NON-INTRUSIVE FLOATING COMPILING STATUS PILL -->
        <div 
          v-if="isCompiling" 
          class="absolute bottom-6 right-6 bg-stone-900/90 hover:bg-stone-900 border border-white/10 backdrop-blur-md rounded-2xl p-4 shadow-2xl z-30 flex items-center gap-4 text-white max-w-xs transition-all pointer-events-auto"
        >
          <div class="relative w-8 h-8 flex-shrink-0 flex items-center justify-center">
            <div class="absolute inset-0 rounded-full border-2 border-white/10 border-t-[#fee33c] animate-spin"></div>
            <span class="material-symbols-outlined text-[14px] text-[#fee33c] animate-pulse">
              {{ showCacheStatus === 'DOWNLOADING_DEFAULT' ? 'downloading' : 'refresh' }}
            </span>
          </div>
          <div class="min-w-0 flex-1">
            <p class="font-heading font-black text-[9px] uppercase tracking-widest text-[#fee33c] truncate">
              <template v-if="showCacheStatus === 'RESTORING'">Caching cinematic loop</template>
              <template v-else-if="showCacheStatus === 'DOWNLOADING_DEFAULT'">Preloading glaze loop</template>
              <template v-else>Compiling movie stream</template>
            </p>
            <div class="flex items-center gap-1.5 mt-0.5" v-if="showCacheStatus !== 'DOWNLOADING_DEFAULT'">
              <div class="flex-1 h-1 bg-white/10 rounded-full overflow-hidden w-28">
                <div 
                  class="h-full bg-gradient-to-r from-purple-500 to-[#fee33c]" 
                  :style="{ width: `${(compileCount / compileTotal) * 100}%` }"
                ></div>
              </div>
              <span class="text-[8px] font-mono text-zinc-400 whitespace-nowrap">
                {{ Math.round((compileCount / compileTotal) * 100) }}%
              </span>
            </div>
            <p v-else class="text-[8px] text-zinc-400 font-mono mt-0.5 leading-none">
              Fetching premium slow-motion glaze loop from servers...
            </p>
          </div>
        </div>

        <!-- SUBTLE MEDIA OPTION CONTROL IN BOTTOM LEFT (NO INTRUSIVE DIALOG) -->
        <input 
          ref="fileInputRef"
          type="file" 
          accept="video/*" 
          class="hidden" 
          @change="onFileSelected" 
        />

        <!-- KINETIC TYPOGRAPHY LAYER: Overlayed directly on top of the full screen video background -->
        <div v-if="!hideText" class="absolute inset-0 z-20 pointer-events-none w-full h-full">
          <div 
            v-for="(item, idx) in currentOverlays" 
            :key="idx"
            :style="getOverlayStyle(idx)"
            class="absolute inset-0 select-none flex p-8 md:p-16 lg:p-24 z-20 pointer-events-none animate-fadeIn"
            :class="[
              (idx % 2 === 0) ? 'items-center justify-end' : 'items-center justify-start'
            ]"
          >
            <div 
              class="max-w-xs md:max-w-md lg:max-w-lg space-y-3 pointer-events-auto"
              :class="[ (idx % 2 === 0) ? 'text-right' : 'text-left' ]"
            >
              <h2 class="font-heading font-black text-white text-3xl md:text-5xl lg:text-7xl tracking-tight leading-none uppercase drop-shadow-[0_4px_16px_rgba(0,0,0,0.95)]">
                {{ item.title }}
              </h2>
              <h3 class="font-heading font-extrabold text-[#fee33c] text-xs md:text-sm uppercase tracking-widest block drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
                {{ item.subtitle }}
              </h3>
              <p class="text-xs md:text-sm text-zinc-100 font-sans leading-relaxed font-semibold drop-shadow-[0_3px_12px_rgba(0,0,0,0.95)]">
                {{ item.desc }}
              </p>
            </div>
          </div>
        </div>

      </div>

    </div>
  </div>
</template>

<style scoped>
canvas {
  image-rendering: -webkit-optimize-contrast;
  image-rendering: crisp-edges;
}
</style>
