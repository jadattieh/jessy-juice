<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { LABELS_SINCE_1991 } from '../data';

const emit = defineEmits(['finish', 'toast']);

const labelIndex = ref(0);
const currentLabel = ref("Pre-heating crepe plates...");
const isVisible = ref(true);
const isSweeping = ref(false);

let textInterval = null;

onMounted(() => {
  textInterval = setInterval(() => {
    currentLabel.value = LABELS_SINCE_1991[labelIndex.value % LABELS_SINCE_1991.length];
    labelIndex.value++;
  }, 160);

  // Sweep out after 1350ms
  setTimeout(() => {
    if (textInterval) clearInterval(textInterval);
    isSweeping.value = true;
    
    setTimeout(() => {
      isVisible.value = false;
      emit('finish');
    }, 800);
  }, 1350);
});

onUnmounted(() => {
  if (textInterval) clearInterval(textInterval);
});
</script>

<template>
  <div 
    v-if="isVisible"
    id="intro-loader" 
    class="fixed inset-0 z-[9999] bg-[#fffdeb] flex flex-col items-center justify-center transition-all duration-[750ms] ease-[cubic-bezier(0.85,0,0.15,1)]"
    :class="[
      isSweeping ? 'translate-y-[-100%] opacity-0 pointer-events-none' : 'pointer-events-auto translateY-0 opacity-100'
    ]"
  >
    <div class="flex flex-col items-center max-w-sm px-6 text-center">
      <!-- Circular Trademark Emblem pulsing in with subtle rotation & gorgeous glow -->
      <div class="w-28 h-28 md:w-32 md:h-32 rounded-full bg-[#fee33c] flex items-center justify-center shadow-[0_12px_40px_rgba(254,227,60,0.4)] border-4 border-amber-300 overflow-hidden select-none animate-springZoom relative">
        <div class="absolute inset-0 bg-white/20 animate-ping opacity-45 rounded-full"></div>
        <svg viewBox="5 15 300 175" class="w-[85%] h-[85%] select-none z-10" xmlns="http://www.w3.org/2000/svg">
          <path d="M 23 25 H 77 V 43 H 59 V 115 C 59 145, 12 145, 10 120 H 28 C 28 132, 41 132, 41 115 V 43 H 23 Z" fill="#863d96" />
          <text x="80" y="86" font-family="'Montserrat', 'Arial Black', sans-serif" font-weight="900" font-size="64" fill="#863d96" letter-spacing="-1">ESSY</text>
          <text x="80" y="146" font-family="'Montserrat', 'Arial Black', sans-serif" font-weight="900" font-size="64" fill="#863d96" letter-spacing="-1">UICE</text>
          <text x="145" y="180" font-family="'Montserrat', sans-serif" font-weight="800" font-size="14" fill="#863d96" letter-spacing="1">SINCE 1991</text>
        </svg>
      </div>

      <!-- Custom Brand Info subtitle -->
      <div class="mt-8 space-y-3 shrink-0 animate-stagger-2">
        <h2 class="font-heading font-black text-[#863d96] text-xl tracking-widest uppercase">Jessy Juice</h2>
        <span class="text-[9px] bg-[#863d96]/10 text-[#863d96] font-heading font-extrabold px-3 py-1.5 rounded-full uppercase tracking-wider block mx-auto w-max">
          Batroun • Lebanon
        </span>
        
        <!-- Cycling progress indicator -->
        <div class="flex items-center justify-center gap-2 pt-4 text-stone-500 font-semibold font-mono text-[10px]">
          <span class="inline-block w-2 h-2 rounded-full bg-secondary animate-pulse"></span>
          <span>{{ currentLabel }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes springZoom {
  0% { transform: scale(0.65); opacity: 0; }
  60% { transform: scale(1.06); opacity: 1; }
  85% { transform: scale(0.97); }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes staggerFadeUp {
  0% { transform: translateY(24px); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
}
.animate-springZoom {
  animation: springZoom 1.1s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
.animate-stagger-2 {
  opacity: 0;
  animation: staggerFadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.22s forwards;
}
</style>
