<script setup>
import { ref, nextTick } from 'vue';

const emit = defineEmits(['add-to-plate-request']);

const isOpen = ref(false);
const inputMessage = ref('');
const isLoading = ref(false);
const chatListContainer = ref(null);

const messages = ref([
  {
    role: "assistant",
    content: "Ahla w Sahla! Welcome to Jessy Juice Boutique! 🍓 I'm Jessy, your sweet helper. Ask me about our legendary exotic cocktails, premium Belgian crepes, or how to design your perfect plate platter! How can I make your day sweeter today? ✨"
  }
]);

const suggestions = [
  "🥑 Recommend an Avocado Cocktail",
  "🍫 What chocolates do you use?",
  "🧇 Are there loaded waffles?",
  "🍽️ How to plan 'My Plate'?"
];

function toggleChat() {
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    scrollToBottom();
  }
}

async function scrollToBottom() {
  await nextTick();
  if (chatListContainer.value) {
    chatListContainer.value.scrollTop = chatListContainer.value.scrollHeight;
  }
}

async function handleSendMessage(text) {
  const query = text.trim();
  if (!query || isLoading.value) return;

  // Add User message
  messages.value.push({ role: 'user', content: query });
  inputMessage.value = '';
  isLoading.value = true;
  scrollToBottom();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages.value })
    });

    if (!response.ok) {
      throw new Error("Sweet virtual helper took a brief chocolate nap. Please try again soon!");
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }

    messages.value.push({ role: 'assistant', content: data.text || "I'm sorry, I didn't catch that. Could you please rephrase?" });
  } catch (err) {
    messages.value.push({
      role: 'assistant',
      content: `🍫 Oh honey, I hit a sweet limit: ${err.message || "Please check your network hookup."}`
    });
  } finally {
    isLoading.value = false;
    scrollToBottom();
  }
}

function handleSuggestion(sug) {
  // Remove the icon for query sending
  const cleanSug = sug.replace(/^[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDC00-\uDFFF]/g, '').trim();
  handleSendMessage(cleanSug);
}
</script>

<template>
  <div class="fixed bottom-6 right-6 z-40 flex flex-col items-end">
    <!-- Chat Window Container -->
    <div 
      v-if="isOpen" 
      class="w-[325px] sm:w-[380px] h-[480px] bg-white rounded-3xl overflow-hidden shadow-[0_20px_50px_rgba(134,61,150,0.22)] border border-stone-150 flex flex-col mb-4 animate-zoomIn"
    >
      <!-- Header -->
      <div class="bg-[#863d96] text-white p-4 flex items-center justify-between shadow-sm relative overflow-hidden">
        <div class="absolute inset-0 bg-radial-gradient from-white/10 to-transparent -z-10"></div>
        <div class="flex items-center gap-3">
          <!-- Mascot Status Icon -->
          <div class="relative">
            <div class="w-10 h-10 rounded-full bg-[#fee33c] text-[#863d96] flex items-center justify-center font-heading font-black text-sm border-2 border-white/40 shadow-xs">
              JJ
            </div>
            <span class="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 border-white animate-pulse"></span>
          </div>
          <div>
            <h4 class="font-heading font-extrabold text-xs tracking-tight">Jessy Companion</h4>
            <p class="text-[10px] text-white/80 font-medium">Boutique Taste Helper • Active</p>
          </div>
        </div>
        <button 
          @click="toggleChat" 
          class="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors cursor-pointer"
        >
          <span class="material-symbols-outlined text-lg">close</span>
        </button>
      </div>

      <!-- Messages Body -->
      <div 
        ref="chatListContainer" 
        class="flex-grow overflow-y-auto p-4 space-y-3 bg-[#fffdf5] scrolling-hide"
      >
        <div 
          v-for="(msg, idx) in messages" 
          :key="idx" 
          class="flex"
          :class="[msg.role === 'user' ? 'justify-end' : 'justify-start']"
        >
          <div 
            class="max-w-[82%] rounded-2xl px-3.5 py-2.5 text-xs font-sans leading-relaxed shadow-xs"
            :class="[
              msg.role === 'user' 
                ? 'bg-[#863d96] text-white rounded-tr-none' 
                : 'bg-white text-[#291830] border border-stone-150/65 rounded-tl-none'
            ]"
          >
            <!-- Render text with basic markdown code formats & emojis -->
            <p class="whitespace-pre-line">{{ msg.content }}</p>
          </div>
        </div>

        <!-- Typing Loading -->
        <div v-if="isLoading" class="flex justify-start">
          <div class="bg-white border border-stone-150/65 rounded-xl rounded-tl-none px-4 py-3 flex items-center gap-1.5 shadow-xs">
            <span class="w-1.5 h-1.5 bg-[#863d96] rounded-full animate-bounce" style="animation-delay: 0ms"></span>
            <span class="w-1.5 h-1.5 bg-[#863d96] rounded-full animate-bounce" style="animation-delay: 150ms"></span>
            <span class="w-1.5 h-1.5 bg-[#863d96] rounded-full animate-bounce" style="animation-delay: 300ms"></span>
          </div>
        </div>
      </div>

      <!-- Quick suggestions drawer -->
      <div class="px-4 py-2.5 bg-stone-50 border-t border-b border-stone-150 flex gap-2 overflow-x-auto scrolling-hide">
        <button 
          v-for="sug in suggestions" 
          :key="sug"
          @click="handleSuggestion(sug)"
          class="text-[10px] font-heading font-extrabold text-[#863d96] bg-white border border-stone-200 hover:bg-[#fee33c]/20 hover:border-[#eed012] px-3 py-1.5 rounded-full whitespace-nowrap shrink-0 shadow-xs transition-colors cursor-pointer"
        >
          {{ sug }}
        </button>
      </div>

      <!-- Footer input -->
      <form @submit.prevent="handleSendMessage(inputMessage)" class="p-3 bg-white border-t border-stone-150 flex gap-2">
        <input 
          v-model="inputMessage"
          type="text" 
          placeholder="Ask Jessy anything sweets..." 
          class="flex-grow bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3 py-2 text-xs placeholder-stone-400 font-sans"
        />
        <button 
          type="submit" 
          class="w-9 h-9 rounded-xl bg-[#863d96] hover:bg-[#723281] text-white flex items-center justify-center shadow-sm cursor-pointer transition-colors"
        >
          <span class="material-symbols-outlined text-sm">send</span>
        </button>
      </form>
    </div>

    <!-- Active Floating Launcher Button -->
    <button 
      @click="toggleChat" 
      class="w-12 h-12 md:w-14 md:h-14 rounded-full bg-[#863d96] text-white flex items-center justify-center shadow-lg border-2 border-[#fffdeb]/80 hover:scale-105 active:scale-95 transition-transform duration-200 relative group cursor-pointer"
      title="Sweet Chat Assistant"
    >
      <div v-if="!isOpen" class="relative">
        <span class="material-symbols-outlined text-2xl md:text-3xl">chat_bubble</span>
        <!-- Ping alert badge -->
        <span class="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-[#fee33c] border-2 border-[#863d96] animate-pulse"></span>
      </div>
      <span v-else class="material-symbols-outlined text-2xl">close</span>
    </button>
  </div>
</template>

<style scoped>
@keyframes zoomIn {
  from { transform: scale(0.95); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
.animate-zoomIn {
  animation: zoomIn 0.28s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
</style>
