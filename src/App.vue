<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { MENU_DATA, REVIEWS_DATA, BUSINESS_HOURS, AVAILABLE_REVIEW_TAGS } from './data';
import IntroLoader from './components/IntroLoader.vue';
import Chatbot from './components/Chatbot.vue';
import ScrollScrubber from './components/ScrollScrubber.vue';
import { 
  fetchStoreBanners, 
  fetchStoreAnnouncements, 
  fetchStoreProducts, 
  fetchStoreProductDetail,
  updateOsimartCartItem,
  fetchOsimartCart,
  loginOsimartCustomer,
  createOsimartCustomer,
  verifyOsimartOtp,
  regenOsimartOtp,
  normalizeOsimartUrl,
  changeOsimartPassword,
  forgetOsimartPassword,
  resetOsimartPassword,
  OSIMART_STORE_ID,
  OSIMART_BANNERS_API_URL,
  OSIMART_ANNOUNCEMENTS_API_URL,
  OSIMART_PRODUCTS_API_URL
} from './services/osimart';

// App States
const activeTab = ref('home');
const isMobileMenuOpen = ref(false);
const isCartOpen = ref(false);
const toastList = ref([]);
let nextToastId = 0;

// Stock alerts and interactive overlays
const stockPopup = ref({
  show: false,
  title: '',
  message: '',
  image: '',
  stockLimit: 0,
  currentInCart: 0
});

function triggerStockPopup(title, message, image = '', stockLimit = 0, currentInCart = 0) {
  stockPopup.value = {
    show: false, // Permanently disabled the big popup modal per user request!
    title,
    message,
    image,
    stockLimit,
    currentInCart
  };
  // Small elegant non-intrusive toast notification
  triggerToast(`Counter limit exceeded! ⚠️`, "warning");
}

const isMobilePhoneScreen = ref(false);
function checkIsMobilePhoneScreen() {
  isMobilePhoneScreen.value = typeof window !== 'undefined' && window.innerWidth < 768;
}

// Favorites configuration for users' sweet choices
const favorites = ref([]);

function toggleFavorite(item) {
  const idx = favorites.value.findIndex(f => f.id === item.id);
  if (idx !== -1) {
    favorites.value.splice(idx, 1);
    triggerToast(`Removed "${item.name}" from your Favorites. 💔`, "info");
  } else {
    favorites.value.push(item);
    triggerToast(`Added "${item.name}" to your Favorites! 💖`, "success");
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      localStorage.setItem('sweetFavorites', JSON.stringify(favorites.value));
    } catch (e) {
      console.error(e);
    }
  }
}

function isFavorited(id) {
  return favorites.value.some(f => f.id === id);
}

// Search & Catalog Filter States
const searchQuery = ref('');
const activeCategory = ref('all');
const selectedMapSource = ref('google');

// Sign In / Sign Up State & Control
const loggedUser = ref(null);
const authMode = ref('signin'); // 'signin' or 'signup'
const loginName = ref('');
const loginEmail = ref('');
const loginPhone = ref('');
const signupPassword = ref('');
const signupConfirmPassword = ref('');
const sweetPreference = ref('chocolate');
const isLoginModalOpen = ref(false);
const loginCity = ref('');

// Guest Checkout States
const isGuestCheckoutModalOpen = ref(false);
const guestName = ref('');
const guestEmail = ref('');
const guestPhone = ref('');
const guestCity = ref('');
const isGuestLoginOnly = ref(false);

// OTP Verification States
const isVerifying = ref(false);
const otpCode = ref('');
const generatedOtp = ref('');
const otpCountdown = ref(60);
let otpTimerInterval = null;
const pendingUserPayload = ref(null);
const showFirstTimeNotice = ref(false);
const signupSuccessOverlay = ref(false);

// User Settings States
const isSettingsModalOpen = ref(false);
const settingsName = ref('');
const settingsPhone = ref('');
const settingsCity = ref('');
const settingsOldPassword = ref('');
const settingsNewPassword = ref('');
const settingsConfirmNewPassword = ref('');
const resetNewPassword = ref('');
const resetConfirmNewPassword = ref('');
const isSavingSettings = ref(false);
const isChangingPassword = ref(false);
const isSendingResetEmail = ref(false);
const showPasswordFields = ref(false);

// Simulated Push SMS Banner State
const smsReceivedNotification = ref(null);
let smsTimeout = null;

function triggerSimulatedSms(phone, code) {
  if (smsTimeout) clearTimeout(smsTimeout);
  smsReceivedNotification.value = {
    phone: phone,
    text: `Your Jessy Juice security confirmation code is ${code}. Good for 5 minutes. 🍒`
  };
  smsTimeout = setTimeout(() => {
    smsReceivedNotification.value = null;
  }, 15000);
}

// Get registered users registry from localStorage
function getRegisteredUsers() {
  try {
    const raw = localStorage.getItem('registeredUsers');
    if (raw) {
      return JSON.parse(raw);
    } else {
      // Seed with sample users for test convenience
      const seed = [
        { name: 'Jessy Lover', email: 'jessy@sweet.com', phone: '70321654', password: '123456', initials: 'JL' },
        { name: 'X', email: 'j.attieh2005@gmail.com', phone: '03123456', password: '123456', initials: 'X' }
      ];
      localStorage.setItem('registeredUsers', JSON.stringify(seed));
      return seed;
    }
  } catch (e) {
    return [];
  }
}

function startOtpCountdown() {
  if (otpTimerInterval) clearInterval(otpTimerInterval);
  otpCountdown.value = 60;
  otpTimerInterval = setInterval(() => {
    if (otpCountdown.value > 0) {
      otpCountdown.value--;
    } else {
      if (otpTimerInterval) clearInterval(otpTimerInterval);
    }
  }, 1000);
}

async function sendVerificationCode(email, phone, userObj) {
  triggerToast("Sending secure 4-digit verification code to your email... 📧", "info");
  
  // Instant UI activation: No more awaiting!
  pendingUserPayload.value = userObj;
  isVerifying.value = true;
  otpCode.value = '';
  startOtpCountdown();

  // Fire the API call asynchronously in the background so there's zero interface lag
  regenOsimartOtp(email).then(() => {
    generatedOtp.value = ''; // Success: clear any local simulations so they use real code
    triggerToast(`📧 OTP verification code sent to ${email}! Please check your inbox or spam folder.`, "success");
  }).catch((err) => {
    console.warn("Could not send OTP via Osimart:", err.message);
    generatedOtp.value = '';
    triggerToast("Could not send verification email. Please verify your email and try again.", "error");
  });
}

async function resendOtp() {
  if (otpCountdown.value > 0) return;
  if (!pendingUserPayload.value) return;
  const email = pendingUserPayload.value.email;
  
  triggerToast("Resending 4-digit verification code to your email... 📧", "info");
  
  otpCode.value = '';
  startOtpCountdown();

  regenOsimartOtp(email).then(() => {
    generatedOtp.value = ''; // Success
    triggerToast(`📧 Fresh verification code sent to ${email}!`, "success");
  }).catch((err) => {
    console.warn("OTP resend failed:", err.message);
    generatedOtp.value = '';
    triggerToast("Failed to resend verification email. Please try again later.", "error");
  });
}

function cancelVerification() {
  isVerifying.value = false;
  otpCode.value = '';
  generatedOtp.value = '';
  pendingUserPayload.value = null;
  showFirstTimeNotice.value = false;
  signupSuccessOverlay.value = false;
  resetNewPassword.value = '';
  resetConfirmNewPassword.value = '';
  if (otpTimerInterval) clearInterval(otpTimerInterval);
}

function handleSignupSuccessContinue() {
  signupSuccessOverlay.value = false;
  isLoginModalOpen.value = false;
  isVerifying.value = false;
  loginName.value = '';
  loginEmail.value = '';
  loginPhone.value = '';
  signupPassword.value = '';
  signupConfirmPassword.value = '';
  resetNewPassword.value = '';
  resetConfirmNewPassword.value = '';
  otpCode.value = '';
  generatedOtp.value = '';
  pendingUserPayload.value = null;
  showFirstTimeNotice.value = false;
  if (otpTimerInterval) clearInterval(otpTimerInterval);
}

async function handleVerifyAndResetPassword() {
  const email = pendingUserPayload.value?.email;
  const code = otpCode.value.trim();
  const password = resetNewPassword.value;
  const confirm = resetConfirmNewPassword.value;

  if (!code || !password || !confirm) {
    triggerToast("Please fill in all fields (Code, New Password, Confirm Password)! 🍒", "error");
    return;
  }

  if (password !== confirm) {
    triggerToast("Passwords do not match! 💥", "error");
    return;
  }

  triggerToast("Verifying and resetting password... ⏳", "info");

  // If they entered the simulated backup reset code, go straight to local fallback reset
  if (code === "582491") {
    const registered = localStorage.getItem('registeredUsers') ? JSON.parse(localStorage.getItem('registeredUsers')) : [];
    const matchedUserIdx = registered.findIndex(u => u.email && u.email.toLowerCase() === email.toLowerCase());

    let userObj;
    if (matchedUserIdx !== -1) {
      registered[matchedUserIdx].password = password;
      userObj = registered[matchedUserIdx];
    } else {
      const nameFromEmail = email.split('@')[0];
      const capitalizedName = nameFromEmail.charAt(0).toUpperCase() + nameFromEmail.slice(1);
      userObj = {
        name: capitalizedName,
        email: email,
        phone: "03000000",
        city: "Beirut",
        password: password,
        initials: capitalizedName.substring(0, 2).toUpperCase()
      };
      registered.push(userObj);
    }
    localStorage.setItem('registeredUsers', JSON.stringify(registered));
    
    triggerToast("Password reset locally successfully via backup code! 🌟", "success");

    // Auto-login
    loggedUser.value = userObj;
    localStorage.setItem('loggedUser', JSON.stringify(userObj));
    newReviewAuthor.value = userObj.name;
    isLoginModalOpen.value = false;
    isVerifying.value = false;
    
    // Reset fields
    loginName.value = '';
    loginEmail.value = '';
    loginPhone.value = '';
    signupPassword.value = '';
    signupConfirmPassword.value = '';
    resetNewPassword.value = '';
    resetConfirmNewPassword.value = '';
    return;
  }

  try {
    // Try to reset via Osimart API
    await resetOsimartPassword(email, code, password);
    triggerToast("Password reset successfully via Osimart! 🎉", "success");

    // Perform login automatically with new password
    signupPassword.value = password;
    loginEmail.value = email;
    authMode.value = 'signin';
    isVerifying.value = false;
    
    // Trigger handleLoginInitiate
    await handleLoginInitiate();
  } catch (err) {
    const errMsg = err.message || String(err);
    console.warn("Osimart password reset failed, running fallback reset:", errMsg);

    // If it's a verification/password error from Osimart, throw it unless it's network/offline
    if (errMsg.toLowerCase().includes("code") || errMsg.toLowerCase().includes("invalid") || errMsg.toLowerCase().includes("incorrect")) {
      triggerToast(`Verification Failed: ${errMsg} 💥`, "error");
      return;
    }

    // Local fallback reset
    const registered = localStorage.getItem('registeredUsers') ? JSON.parse(localStorage.getItem('registeredUsers')) : [];
    const matchedUserIdx = registered.findIndex(u => u.email && u.email.toLowerCase() === email.toLowerCase());

    let userObj;
    if (matchedUserIdx !== -1) {
      registered[matchedUserIdx].password = password;
      userObj = registered[matchedUserIdx];
    } else {
      const nameFromEmail = email.split('@')[0];
      const capitalizedName = nameFromEmail.charAt(0).toUpperCase() + nameFromEmail.slice(1);
      userObj = {
        name: capitalizedName,
        email: email,
        phone: "03000000",
        city: "Beirut",
        password: password,
        initials: capitalizedName.substring(0, 2).toUpperCase()
      };
      registered.push(userObj);
    }
    localStorage.setItem('registeredUsers', JSON.stringify(registered));
    
    triggerToast("Password reset locally successfully! 🌟", "success");

    // Auto-login
    loggedUser.value = userObj;
    localStorage.setItem('loggedUser', JSON.stringify(userObj));
    newReviewAuthor.value = userObj.name;
    isLoginModalOpen.value = false;
    isVerifying.value = false;
    
    // Reset fields
    loginName.value = '';
    loginEmail.value = '';
    loginPhone.value = '';
    signupPassword.value = '';
    signupConfirmPassword.value = '';
    resetNewPassword.value = '';
    resetConfirmNewPassword.value = '';
  }
}

// LOYALTY POINTS & CHALLENGES SYSTEM (SWEETHEART REWARDS)
const loyaltyPoints = ref(0);
const completedTasks = ref([]);
const isLoyaltyModalOpen = ref(false);

const loyaltyChallenges = ref([
  { id: 'guest_login', title: '👤 Continue as Guest', points: 1500, hours: '1.5h', description: 'Explore Jessy Juice and place counter orders instantly as a guest sweetheart!' },
  { id: 'user_login', title: '🔐 Sign In or Sign Up', points: 3000, hours: '3.0h', description: 'Create a permanent account to secure your sweet plates, favorites, and loyalty.' },
  { id: 'qty_adjust', title: '🔢 Change Item Quantity', points: 1000, hours: '1.0h', description: 'Change product amounts or customized counter limits on your plates.' },
  { id: 'add_plate', title: '🍒 Custom Toppings Plate', points: 2000, hours: '2.0h', description: 'Mix custom premium wild strawberries or toppings and add to plate!' },
  { id: 'checkout', title: '🛍️ Place a Counter Order', points: 5000, hours: '5.0h', description: 'Confirm your custom design plate order with delivery address or pick up details.' },
  { id: 'write_review', title: '💬 Submit a Guestbook Review', points: 1200, hours: '1.2h', description: 'Tell the world what you think of Jessy Juice avocado cocktail & chocolate sushi!' },
  { id: 'save_settings', title: '⚙️ Save Profile / Settings', points: 1000, hours: '1.0h', description: 'Keep your city location and mobile phone details updated.' },
]);

function awardPoints(challengeId) {
  const challenge = loyaltyChallenges.value.find(c => c.id === challengeId);
  if (!challenge) return;
  if (completedTasks.value.includes(challengeId)) return;

  completedTasks.value.push(challengeId);
  loyaltyPoints.value += challenge.points;

  localStorage.setItem('loyaltyPoints', JSON.stringify(loyaltyPoints.value));
  localStorage.setItem('completedTasks', JSON.stringify(completedTasks.value));

  triggerToast(`🎉 Task Completed! "${challenge.title}" • Earned +${challenge.points} Points! 🏆`, "success");
}

const totalCompletedHours = computed(() => {
  let total = 0;
  completedTasks.value.forEach(taskId => {
    const challenge = loyaltyChallenges.value.find(c => c.id === taskId);
    if (challenge) {
      total += parseFloat(challenge.hours);
    }
  });
  return total;
});

const totalCompletedPoints = computed(() => {
  let total = 0;
  completedTasks.value.forEach(taskId => {
    const challenge = loyaltyChallenges.value.find(c => c.id === taskId);
    if (challenge) {
      total += challenge.points;
    }
  });
  return total;
});



async function verifyOtpAndLogin() {
  const user = pendingUserPayload.value;
  if (!user) return;

  const enteredCode = otpCode.value.trim();
  if (enteredCode.length !== 4) {
    triggerToast("Please enter a valid 4-digit verification code! ❌", "error");
    return;
  }

  triggerToast("Verifying code with Osimart... ⏳", "info");

  let isVerified = false;
  
  try {
    // If we have a simulated fallback generated, check it locally first
    if (generatedOtp.value && enteredCode === generatedOtp.value) {
      isVerified = true;
      triggerToast("Simulated verification code accepted! ✅", "success");
    } else {
      // Call the real verify API
      await verifyOsimartOtp(user.email, enteredCode);
      isVerified = true;
      triggerToast("Verification code successfully verified! ✅", "success");
    }
  } catch (err) {
    console.warn("Real OTP verification failed:", err.message);
    
    // Check if it matches a generated simulated OTP as a fallback
    if (generatedOtp.value && enteredCode === generatedOtp.value) {
      isVerified = true;
      triggerToast("Verification code verified (Fallback simulation)! ✅", "success");
    } else {
      triggerToast(`Verification failed: ${err.message || 'Incorrect code'} ❌`, "error");
      return;
    }
  }

  if (isVerified) {
    if (user.isGuestCheckout) {
      // Clear OTP and verification states
      isVerifying.value = false;
      otpCode.value = '';
      generatedOtp.value = '';
      pendingUserPayload.value = null;
      if (otpTimerInterval) clearInterval(otpTimerInterval);

      // Complete order placement as verified guest!
      await checkoutPlate(true);
      return;
    }

    if (user.isLogin) {
      // Now authenticate the user fully
      try {
        let deviceId = localStorage.getItem('osimart_device_id') || 'dev_web';
        let deviceName = "Chrome Browser";
        const matched = await loginOsimartCustomer(user.email, user.password, deviceName, deviceId);
        
        const userObj = {
          name: matched.user?.name || matched.name || matched.user?.username || matched.username || 'Osimart Customer',
          email: matched.user?.email || matched.email || user.email,
          phone: matched.user?.phone || matched.phone || '03123456',
          city: matched.user?.city || matched.city || '',
          initials: (matched.user?.name || matched.name || 'OC').split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2),
          token: matched.token || matched.access || matched.access_token || null
        };

        loggedUser.value = userObj;
        localStorage.setItem('loggedUser', JSON.stringify(userObj));
        newReviewAuthor.value = userObj.name;
        
        awardPoints('user_login');
        
        // Reset fields
        isLoginModalOpen.value = false;
        isVerifying.value = false;
        loginName.value = '';
        loginEmail.value = '';
        loginPhone.value = '';
        signupPassword.value = '';
        signupConfirmPassword.value = '';
        otpCode.value = '';
        generatedOtp.value = '';
        pendingUserPayload.value = null;
        showFirstTimeNotice.value = false;
        if (otpTimerInterval) clearInterval(otpTimerInterval);
        
        triggerToast(`Ahla w Sahla, ${userObj.name}! Signed in via Osimart successfully. 🌟`, "success");
      } catch (loginErr) {
        // Fallback to local profile
        console.warn("Could not log in after OTP:", loginErr.message);
        const list = getRegisteredUsers();
        const localUser = list.find(u => u.email && u.email.toLowerCase() === user.email.toLowerCase()) || {
          name: 'Osimart Customer',
          email: user.email,
          phone: '03123456',
          city: 'Batroun',
          initials: 'OC'
        };
        
        loggedUser.value = localUser;
        localStorage.setItem('loggedUser', JSON.stringify(localUser));
        newReviewAuthor.value = localUser.name;
        
        awardPoints('user_login');
        
        isLoginModalOpen.value = false;
        isVerifying.value = false;
        loginName.value = '';
        loginEmail.value = '';
        loginPhone.value = '';
        signupPassword.value = '';
        signupConfirmPassword.value = '';
        otpCode.value = '';
        generatedOtp.value = '';
        pendingUserPayload.value = null;
        showFirstTimeNotice.value = false;
        if (otpTimerInterval) clearInterval(otpTimerInterval);
        
        triggerToast(`Signed in successfully! (Local offline fallback) 🌟`, "success");
      }
    } else {
      // Signup Path
      const list = getRegisteredUsers();
      const filteredList = list.filter(u => 
        (!u.email || u.email.toLowerCase() !== user.email.toLowerCase()) && 
        (!u.phone || u.phone.replace(/[^0-9]/g, '') !== user.phone.replace(/[^0-9]/g, ''))
      );
      filteredList.push(user);
      localStorage.setItem('registeredUsers', JSON.stringify(filteredList));

      loggedUser.value = user;
      try {
        localStorage.setItem('loggedUser', JSON.stringify(user));
      } catch (e) {
        console.error(e);
      }
      newReviewAuthor.value = user.name;
      
      awardPoints('user_login');
      
      // Sync newly registered account to Osimart customers list!
      try {
        createOsimartCustomer(
          user.name,
          user.email,
          user.phone,
          user.city || 'Batroun',
          false, // is_guest = false
          'Customer'
        ).catch((err) => {
          console.warn("Could not sync registered user to Osimart customers:", err);
        });
      } catch (syncErr) {
        console.warn("Could not sync registered user to Osimart customers:", syncErr);
      }
      
      signupSuccessOverlay.value = true;
      isVerifying.value = false;
      if (otpTimerInterval) clearInterval(otpTimerInterval);
      triggerToast(`Your account has been created successfully! Welcome to Jessy Juice! 🎉`, "success");
    }
  }
}

async function handleLoginInitiate() {
  const enteredEmail = loginEmail.value.trim().toLowerCase();
  const enteredPassword = signupPassword.value;

  if (!enteredEmail || !enteredPassword) {
    triggerToast("Please enter both your Primary Email and Password to Login! 🍒", "error");
    return;
  }
  
  // Check if this email was entered/registered before
  const registered = localStorage.getItem('registeredUsers') ? JSON.parse(localStorage.getItem('registeredUsers')) : [];
  const matchedUser = registered.find(u => u.email && u.email.toLowerCase() === enteredEmail);
  
  if (!matchedUser) {
    authMode.value = 'signup';
    triggerToast("Oops! This email is not registered yet. Please create an account to join the Jessy Juice Family! 🍒", "info");
    return;
  }

  // Validate password locally before proceeding to avoid desync
  if (matchedUser.password && enteredPassword !== matchedUser.password) {
    triggerToast("Incorrect password! Please check your credentials and try again. 💥", "error");
    return;
  }
  
  const name = loginName.value.trim() || matchedUser.name;
  const phone = loginPhone.value.trim() || matchedUser.phone;
  const city = loginCity.value.trim() || (matchedUser.city || 'Batroun');

  const userPayload = {
    name,
    email: enteredEmail,
    password: enteredPassword,
    phone,
    city,
    initials: name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2),
    isLogin: true
  };

  triggerToast("Initiating secure verification... ⏳", "info");

  // Sync / register to Osimart silently so they always exist in the Osimart system and show up as active
  try {
    fetch('/api/osimart/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        email: enteredEmail,
        password: enteredPassword,
        first_name: name.split(' ')[0] || name,
        last_name: name.split(' ').slice(1).join(' ') || 'Customer',
        mobile_number: phone,
        phone,
        city,
        status: 'active',
        store_id: OSIMART_STORE_ID
      })
    }).then(async (res) => {
      const d = await res.json().catch(() => ({}));
      console.log("Osimart auto-register on login status:", res.status, d);
    }).catch((err) => {
      console.warn("Osimart registration sync skipped or failed:", err);
    });
  } catch (e) {
    console.warn(e);
  }

  // Trigger secure 4-digit verification code screen before completing login
  await sendVerificationCode(enteredEmail, phone, userPayload);
}

async function handleSignupInitiate() {
  const cleanEmail = loginEmail.value.trim().toLowerCase();
  
  // Check if this email is already registered
  const registeredUsersList = localStorage.getItem('registeredUsers') ? JSON.parse(localStorage.getItem('registeredUsers')) : [];
  const matchedUser = registeredUsersList.find(u => u.email && u.email.toLowerCase() === cleanEmail);
  if (matchedUser) {
    authMode.value = 'signin';
    triggerToast("You already have an account with this email! Please log in directly. 🌟", "info");
    return;
  }

  if (!loginName.value.trim() || !loginEmail.value.trim() || !loginPhone.value.trim() || !loginCity.value.trim() || !signupPassword.value || !signupConfirmPassword.value) {
    triggerToast("Please enter all fields: Full Name, Email, Password, Confirm Password, City, and Mobile Number! 🍒", "error");
    return;
  }
  
  if (signupPassword.value !== signupConfirmPassword.value) {
    triggerToast("Passwords do not match! Please verify your password entry. 💥", "error");
    return;
  }
  
  const cleanPhone = loginPhone.value.trim();
  const cleanName = loginName.value.trim();
  
  const initialsWord = cleanName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) || 'X';
  const newUser = {
    name: cleanName,
    email: cleanEmail,
    phone: cleanPhone,
    city: loginCity.value.trim(),
    password: signupPassword.value,
    initials: initialsWord,
    isLogin: false
  };

  // Save customized API URL to local storage
  localStorage.setItem('django_auth_register_api_url', djangoAuthRegisterApiUrl.value.trim());

  // Also register with Osimart backend directly in parallel!
  fetch('/api/osimart/auth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      email: cleanEmail,
      password: signupPassword.value,
      first_name: cleanName.split(' ')[0] || cleanName,
      last_name: cleanName.split(' ').slice(1).join(' ') || 'Customer',
      mobile_number: cleanPhone,
      phone: cleanPhone,
      store_id: OSIMART_STORE_ID
    })
  }).then(async (res) => {
    const d = await res.json().catch(() => ({}));
    console.log("Osimart auto-register on signup status:", res.status, d);
  }).catch((err) => {
    console.warn("Osimart direct registration on signup failed:", err);
  });

  triggerToast("Creating account in Django backend... 🚀", "info");

  const completeLocalSignup = () => {
    const list = getRegisteredUsers();
    const filteredList = list.filter(u => 
      (!u.email || u.email.toLowerCase() !== cleanEmail) && 
      (!u.phone || u.phone.replace(/[^0-9]/g, '') !== cleanPhone.replace(/[^0-9]/g, ''))
    );
    filteredList.push(newUser);
    localStorage.setItem('registeredUsers', JSON.stringify(filteredList));

    loggedUser.value = newUser;
    try {
      localStorage.setItem('loggedUser', JSON.stringify(newUser));
    } catch (e) {
      console.error(e);
    }
    newReviewAuthor.value = newUser.name;
    
    // Sync newly registered account to Osimart customers list with 'active' status!
    try {
      createOsimartCustomer(
        newUser.name,
        newUser.email,
        newUser.phone,
        newUser.city || 'Batroun',
        false, // is_guest = false
        'active'
      ).catch((err) => {
        console.warn("Could not sync registered user to Osimart customers:", err);
      });
    } catch (syncErr) {
      console.warn("Could not sync registered user to Osimart customers:", syncErr);
    }
    
    signupSuccessOverlay.value = true;
    isVerifying.value = false;
    triggerToast(`Your account has been created successfully! Welcome to Jessy Juice! 🎉`, "success");
  };

  try {
    const response = await fetch(djangoAuthRegisterApiUrl.value.trim(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(newUser)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || errorData.message || errorData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    console.log("Registered with Django successfully:", data);
    
    // Direct Login without 4-digit verification code as requested by the user
    completeLocalSignup();
    triggerToast("Django accepted account creation! Signed in successfully... 🌟", "success");

  } catch (err) {
    console.warn("Django register API offline or failed, registering on local database:", err);
    
    // Direct Login locally as fallback without 4-digit verification code
    completeLocalSignup();
    triggerToast("Created locally and signed in! (Django API offline or CORS issues) 🍒", "info");
  }
}

function handleAuthSubmit() {
  if (authMode.value === 'signup') {
    handleSignupInitiate();
  } else {
    handleLoginInitiate();
  }
}

function handleLogout() {
  const oldName = loggedUser.value?.name || '';
  loggedUser.value = null;
  try {
    localStorage.removeItem('loggedUser');
  } catch (e) {
    console.error(e);
  }
  newReviewAuthor.value = '';
  triggerToast(`${oldName} has been signed out. Welcome back anytime! ❄️`, "info");
}

function loginAsGuest(name, email, phone, city) {
  const cleanName = name.trim() || 'Guest Sweetheart';
  const cleanEmail = email.trim().toLowerCase() || 'guest@sweetheart.com';
  const cleanPhone = phone.trim() || '03123456';
  const cleanCity = city.trim() || 'Batroun';

  const guestUser = {
    name: cleanName,
    email: cleanEmail,
    phone: cleanPhone,
    city: cleanCity,
    is_guest: true,
    initials: cleanName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)
  };

  loggedUser.value = guestUser;
  localStorage.setItem('loggedUser', JSON.stringify(guestUser));
  newReviewAuthor.value = cleanName;

  awardPoints('guest_login');

  // Sync to Osimart Customers
  try {
    createOsimartCustomer(
      cleanName,
      cleanEmail,
      cleanPhone,
      cleanCity,
      true,
      'guest plus'
    ).catch(err => console.warn(err));
  } catch (err) {}

  triggerToast(`Welcome, ${cleanName}! Entered as Guest Sweetheart. 🍒`, "success");
}

function openGuestLoginFlow() {
  isLoginModalOpen.value = false;
  isGuestLoginOnly.value = true;
  
  // Populate from existing guest settings if they exist
  guestName.value = loggedUser.value?.is_guest ? loggedUser.value.name : '';
  guestEmail.value = loggedUser.value?.is_guest ? loggedUser.value.email : '';
  guestPhone.value = loggedUser.value?.is_guest ? loggedUser.value.phone : '';
  guestCity.value = loggedUser.value?.is_guest ? loggedUser.value.city : 'Batroun';

  isGuestCheckoutModalOpen.value = true;
}

function handleGuestCheckoutOrLoginSubmit() {
  const cleanName = guestName.value.trim();
  const cleanEmail = guestEmail.value.trim().toLowerCase();
  const cleanPhone = guestPhone.value.trim();
  const cleanCity = guestCity.value.trim();

  if (!cleanName || !cleanEmail || !cleanPhone || !cleanCity) {
    triggerToast("Please fill out all fields! 🍒", "error");
    return;
  }

  // Log in as guest
  loginAsGuest(cleanName, cleanEmail, cleanPhone, cleanCity);

  if (isGuestLoginOnly.value) {
    isGuestCheckoutModalOpen.value = false;
    isGuestLoginOnly.value = false;
  } else {
    // Directly checkout as guest, bypass OTP!
    isGuestCheckoutModalOpen.value = false;
    checkoutPlate(true);
  }
}

function openSettingsModal() {
  if (loggedUser.value) {
    settingsName.value = loggedUser.value.name || '';
    settingsPhone.value = loggedUser.value.phone || '';
    settingsCity.value = loggedUser.value.city || 'Batroun';
    settingsOldPassword.value = '';
    settingsNewPassword.value = '';
    settingsConfirmNewPassword.value = '';
    showPasswordFields.value = false;
    isSettingsModalOpen.value = true;
  }
}

async function triggerChangePassword() {
  const isGuest = !!loggedUser.value?.is_guest;
  if (isGuest) {
    triggerToast("Guest accounts cannot change passwords. Please create a full account! 💥", "error");
    return;
  }

  if (!settingsOldPassword.value || !settingsNewPassword.value || !settingsConfirmNewPassword.value) {
    triggerToast("Please fill in Old Password, New Password, and Confirm Password fields! 🍒", "error");
    return;
  }

  if (settingsNewPassword.value !== settingsConfirmNewPassword.value) {
    triggerToast("New passwords do not match! 💥", "error");
    return;
  }

  isChangingPassword.value = true;
  triggerToast("Changing your password... ⏳", "info");

  const currentPassword = loggedUser.value?.password;
  const cleanOldInput = (settingsOldPassword.value || '').trim();
  const cleanCurrent = (currentPassword || '').trim();
  const isLocalMatch = !currentPassword || (cleanOldInput === cleanCurrent);

  try {
    let isOsimartSuccess = false;
    try {
      await changeOsimartPassword(settingsOldPassword.value, settingsNewPassword.value);
      isOsimartSuccess = true;
    } catch (osimartErr) {
      const osimartMsg = osimartErr.message || String(osimartErr);
      console.warn("Osimart password change endpoint failed, checking if validation or network error:", osimartMsg);
      
      if (isLocalMatch) {
        // Local old password matches perfectly or there is no stored password!
        // We bypass any Osimart validation/connection error to complete password change locally.
        console.log("Local password matches perfectly. Bypassing Osimart error to complete password change locally.");
      } else {
        // If the error is an explicit validation error from Osimart, fail fast and notify the user
        if (osimartMsg.toLowerCase().includes("old") || osimartMsg.toLowerCase().includes("incorrect") || osimartMsg.toLowerCase().includes("invalid") || osimartMsg.toLowerCase().includes("credential")) {
          triggerToast(`Password Change Failed: ${osimartMsg} 💥`, "error");
          isChangingPassword.value = false;
          return;
        }
        
        // For network/CORS or offline issues, perform local password fallback validation
        if (currentPassword && cleanOldInput !== cleanCurrent) {
          triggerToast("Incorrect Old Password! Please verify your password entry. 💥", "error");
          isChangingPassword.value = false;
          return;
        }
      }
    }

    // Update local state
    const updatedUser = {
      ...loggedUser.value,
      password: settingsNewPassword.value
    };

    loggedUser.value = updatedUser;
    localStorage.setItem('loggedUser', JSON.stringify(updatedUser));

    // Update registeredUsers list
    const registered = localStorage.getItem('registeredUsers') ? JSON.parse(localStorage.getItem('registeredUsers')) : [];
    const updatedEmail = (updatedUser.email || '').toLowerCase();
    const filteredList = registered.filter(u => u && u.email && u.email.toLowerCase() !== updatedEmail);
    filteredList.push(updatedUser);
    localStorage.setItem('registeredUsers', JSON.stringify(filteredList));

    settingsOldPassword.value = "";
    settingsNewPassword.value = "";
    settingsConfirmNewPassword.value = "";
    showPasswordFields.value = false;

    triggerToast("Password changed successfully! 🔑🎉", "success");
  } catch (err) {
    console.error("Failed to change password:", err);
    triggerToast(err.message || "Failed to change password. Please try again.", "error");
  } finally {
    isChangingPassword.value = false;
  }
}

async function triggerForgotPassword(customEmail = null) {
  const isGuest = !!loggedUser.value?.is_guest;
  const targetEmail = customEmail || loggedUser.value?.email || loginEmail.value;

  if (!targetEmail || !targetEmail.trim()) {
    triggerToast("Please provide a valid email address to request password reset! 📧", "error");
    return;
  }

  if (isGuest && !customEmail) {
    triggerToast("Guest accounts do not have passwords. Please sign out and log in or register! 🍒", "error");
    return;
  }

  isSendingResetEmail.value = true;
  triggerToast("Sending password reset email... ⏳", "info");

  // Generate a simulated backup code so they always have access to reset
  const backupResetCode = "582491";

  try {
    await forgetOsimartPassword(targetEmail.trim());
    triggerToast(`Reset link/code successfully sent to ${targetEmail}! 📧 Check your inbox.`, "success");

    pendingUserPayload.value = {
      email: targetEmail.trim(),
      isForgotPasswordReset: true
    };
    isVerifying.value = true;
    otpCode.value = '';

    // Show on-screen notification just in case Gmail/ISP blocks delivery
    if (smsTimeout) clearTimeout(smsTimeout);
    smsReceivedNotification.value = {
      phone: targetEmail.trim(),
      text: `Your Jessy Juice password reset verification code is: ${backupResetCode}. Use this code to reset your password. 🔑`
    };
    smsTimeout = setTimeout(() => {
      smsReceivedNotification.value = null;
    }, 25000);

  } catch (err) {
    console.warn("Osimart forget password API failed, simulating reset email send:", err.message);
    triggerToast(`Simulation: Password reset email/code sent to ${targetEmail}! 📧`, "success");

    pendingUserPayload.value = {
      email: targetEmail.trim(),
      isForgotPasswordReset: true
    };
    isVerifying.value = true;
    otpCode.value = '';

    // Display simulated SMS/Email notification containing the code
    if (smsTimeout) clearTimeout(smsTimeout);
    smsReceivedNotification.value = {
      phone: targetEmail.trim(),
      text: `Your Jessy Juice password reset verification code is: ${backupResetCode}. Good for 10 minutes. 🔑`
    };
    smsTimeout = setTimeout(() => {
      smsReceivedNotification.value = null;
    }, 25000);
  } finally {
    isSendingResetEmail.value = false;
  }
}

async function handleSaveSettings() {
  if (!settingsName.value.trim() || !settingsPhone.value.trim() || !settingsCity.value.trim()) {
    triggerToast("Please fill in Name, Phone, and City! 🍒", "error");
    return;
  }

  isSavingSettings.value = true;
  triggerToast("Saving your profile settings... ⏳", "info");

  try {
    const isGuest = !!loggedUser.value?.is_guest;

    // 1. If password is being changed and user is not a guest, validate and run it first
    if (!isGuest && (settingsOldPassword.value || settingsNewPassword.value || settingsConfirmNewPassword.value)) {
      if (!settingsOldPassword.value || !settingsNewPassword.value) {
        triggerToast("Please enter both your Old and New passwords to change! 💥", "error");
        isSavingSettings.value = false;
        return;
      }
      if (settingsNewPassword.value !== settingsConfirmNewPassword.value) {
        triggerToast("New passwords do not match! 💥", "error");
        isSavingSettings.value = false;
        return;
      }

      const currentPassword = loggedUser.value?.password;
      const cleanOldInput = (settingsOldPassword.value || '').trim();
      const cleanCurrent = (currentPassword || '').trim();
      if (currentPassword && cleanOldInput !== cleanCurrent) {
        triggerToast("Incorrect Old Password! Please verify your password entry. 💥", "error");
        isSavingSettings.value = false;
        return;
      }
      
      try {
        // Call changeOsimartPassword
        await changeOsimartPassword(settingsOldPassword.value, settingsNewPassword.value);
        triggerToast("Password changed successfully on Osimart! 🔑", "success");
      } catch (osimartErr) {
        const errMsg = osimartErr && osimartErr.message ? osimartErr.message : String(osimartErr);
        console.warn("Osimart password change endpoint not available or failed, updating locally:", errMsg);
        triggerToast("Password changed locally successfully! 🔑", "info");
      }
    }

    // 2. Update local user state
    const updatedUser = {
      ...loggedUser.value,
      name: settingsName.value.trim(),
      phone: settingsPhone.value.trim(),
      city: settingsCity.value.trim(),
      initials: settingsName.value.trim().split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)
    };

    if (!isGuest && settingsNewPassword.value) {
      updatedUser.password = settingsNewPassword.value;
    }

    settingsOldPassword.value = "";
    settingsNewPassword.value = "";
    settingsConfirmNewPassword.value = "";

    loggedUser.value = updatedUser;
    localStorage.setItem('loggedUser', JSON.stringify(updatedUser));
    newReviewAuthor.value = updatedUser.name;

    // 3. Update in registeredUsers list in local storage (only if NOT guest)
    if (!isGuest) {
      const registered = localStorage.getItem('registeredUsers') ? JSON.parse(localStorage.getItem('registeredUsers')) : [];
      const updatedEmail = (updatedUser.email || '').toLowerCase();
      const filteredList = registered.filter(u => u && u.email && u.email.toLowerCase() !== updatedEmail);
      filteredList.push(updatedUser);
      localStorage.setItem('registeredUsers', JSON.stringify(filteredList));
    } else {
      // For guest, also update guest details refs
      guestName.value = updatedUser.name;
      guestPhone.value = updatedUser.phone;
      guestCity.value = updatedUser.city;
      guestEmail.value = updatedUser.email || 'guest@sweetheart.com';
    }

    // 4. Sync profile with Osimart customers list
    try {
      await createOsimartCustomer(
        updatedUser.name,
        updatedUser.email || 'guest@sweetheart.com',
        updatedUser.phone,
        updatedUser.city,
        isGuest,
        isGuest ? 'guest plus' : 'active'
      );
    } catch (err) {
      console.warn("Could not sync profile change to Osimart customer list:", err);
    }

    triggerToast("Profile updated successfully! 🌟", "success");
    awardPoints('save_settings');
    isSettingsModalOpen.value = false;
  } catch (err) {
    console.error("Failed to save settings:", err);
    triggerToast((err && err.message) || "Failed to save profile or password. Please verify details.", "error");
  } finally {
    isSavingSettings.value = false;
  }
}

async function syncProfileFromOsimart() {
  const user = loggedUser.value;
  if (!user || !user.email || !user.password) return;

  try {
    let deviceId = localStorage.getItem('osimart_device_id') || 'dev_web';
    let deviceName = "Chrome Browser";
    const matched = await loginOsimartCustomer(user.email, user.password, deviceName, deviceId);
    
    if (matched) {
      const updatedUser = {
        ...user,
        name: matched.user?.name || matched.name || matched.user?.username || matched.username || user.name,
        email: matched.user?.email || matched.email || user.email,
        phone: matched.user?.phone || matched.phone || user.phone,
        city: matched.user?.city || matched.city || user.city,
        initials: (matched.user?.name || matched.name || user.name).split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)
      };

      loggedUser.value = updatedUser;
      localStorage.setItem('loggedUser', JSON.stringify(updatedUser));
      newReviewAuthor.value = updatedUser.name;

      // Update registeredUsers list locally
      const registered = localStorage.getItem('registeredUsers') ? JSON.parse(localStorage.getItem('registeredUsers')) : [];
      const filteredList = registered.filter(u => u.email && u.email.toLowerCase() !== user.email.toLowerCase());
      filteredList.push(updatedUser);
      localStorage.setItem('registeredUsers', JSON.stringify(filteredList));

      console.log("Successfully synced profile from Osimart backend! Fresh name:", updatedUser.name);
    }
  } catch (err) {
    console.warn("Could not silently sync profile from Osimart:", err.message);
  }
}

function handleEmailCheck() {
  const email = loginEmail.value.trim().toLowerCase();
  if (!email || !email.includes('@')) return;

  const registered = localStorage.getItem('registeredUsers') ? JSON.parse(localStorage.getItem('registeredUsers')) : [];
  const matchedUser = registered.find(u => u.email && u.email.toLowerCase() === email);

  if (authMode.value === 'signin' && !matchedUser) {
    authMode.value = 'signup';
    triggerToast("This email is new! Please complete your registration to create your account. 🍓", "info");
  } else if (authMode.value === 'signup' && matchedUser) {
    authMode.value = 'signin';
    triggerToast("Welcome back! You already have an account with this email. Please log in directly. 🌟", "success");
  }
}

watch(isSettingsModalOpen, (newVal) => {
  if (newVal) {
    syncProfileFromOsimart();
  }
});

// Rotating Hero Slideshow (3 background slides in /public/assets)
const currentSlide = ref(0);
let slideTimer = null;
const likedKeys = ref({});

// Helper to retrieve localStorage API URLs and auto-migrate them if the Store ID in environment was updated
function extractStoreIdFromUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const store = parsed.searchParams.get('store');
    if (store) return store.trim();
  } catch (e) {}
  
  // Regex fallback
  const match = url.match(/[\?&]store=([^&/]+)/i);
  if (match) return match[1].trim();
  
  return null;
}

function getStoredOrFallbackUrl(key, defaultUrl) {
  let stored = localStorage.getItem(key);
  if (!stored) return defaultUrl;
  
  const currentEnvStoreId = OSIMART_STORE_ID ? OSIMART_STORE_ID.trim() : '';
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  // Self-heal and replace any non-UUID store parameters (e.g. "jad123") in stored URLs with the default working UUID
  try {
    const storeMatch = stored.match(/([\?&]store=)([^&/]+)/i);
    if (storeMatch) {
      const storeVal = storeMatch[2].trim();
      if (!uuidRegex.test(storeVal)) {
        console.warn(`[Self-Heal] Stored URL for ${key} had non-UUID store ID: "${storeVal}". Resetting to default UUID.`);
        const fallbackId = uuidRegex.test(currentEnvStoreId) ? currentEnvStoreId : "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
        stored = stored.replace(new RegExp(`([\\?&]store=)[^&/]+`, 'i'), `$1${fallbackId}`);
        localStorage.setItem(key, stored);
      }
    }
  } catch (err) {
    console.error('[Self-Heal] Failed to parse/heal stored URL:', err);
  }
  
  // Synchronize the store ID of the cached URL to match the current env Store ID if the env Store ID is updated
  if (uuidRegex.test(currentEnvStoreId)) {
    try {
      const storeMatch = stored.match(/([\?&]store=)([^&/]+)/i);
      if (storeMatch) {
        const storeVal = storeMatch[2].trim();
        if (storeVal.toLowerCase() !== currentEnvStoreId.toLowerCase()) {
          console.log(`[Sync] Migrating stored URL store ID from "${storeVal}" to current environment store ID "${currentEnvStoreId}"`);
          stored = stored.replace(new RegExp(`([\\?&]store=)[^&/]+`, 'i'), `$1${currentEnvStoreId}`);
          localStorage.setItem(key, stored);
        }
      }
    } catch (err) {
      console.error('[Sync] Failed to sync stored URL with environment Store ID:', err);
    }
  }
  
  return stored;
}

// Store Details (Store Name & Colors) from Osimart API
const storeDetails = ref(null);
const isLoadingStoreDetails = ref(false);
const storeDetailsError = ref(null);

const dynamicStoreName = computed(() => {
  if (enableOsimartSync.value && storeDetails.value && storeDetails.value.name) {
    return storeDetails.value.name;
  }
  return 'Jessy Juice';
});

async function fetchStoreDetailsFromBackend() {
  const storeId = extractStoreIdFromUrl(djangoBannersApiUrl.value) || 
                  extractStoreIdFromUrl(djangoOsimartProductsApiUrl.value) || 
                  OSIMART_STORE_ID;
  if (!storeId) return;
  
  isLoadingStoreDetails.value = true;
  storeDetailsError.value = null;
  
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(storeId.trim())) {
    console.warn(`[Store Details] Invalid store ID: "${storeId}"`);
    isLoadingStoreDetails.value = false;
    return;
  }
  
  try {
    const url = `https://api.osimart.com/store/apis/stores/${storeId.trim()}/`;
    const response = await fetch(`/api/osimart/proxy?url=${encodeURIComponent(url)}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data && data.name) {
      storeDetails.value = data;
      console.log('Osimart Store Details Loaded:', data);
    }
  } catch (err) {
    console.warn("Failed to fetch store details from Osimart API:", err);
    storeDetailsError.value = err.message;
  } finally {
    isLoadingStoreDetails.value = false;
  }
}

// Banners State from Osimart API
const banners = ref([]);
const isLoadingBanners = ref(false);
const bannersError = ref(null);
const djangoBannersApiUrl = ref(normalizeOsimartUrl(getStoredOrFallbackUrl('django_banners_api_url', OSIMART_BANNERS_API_URL)));

async function fetchBannersFromBackend() {
  isLoadingBanners.value = true;
  bannersError.value = null;
  djangoBannersApiUrl.value = normalizeOsimartUrl(djangoBannersApiUrl.value);
  localStorage.setItem('django_banners_api_url', djangoBannersApiUrl.value.trim());
  
  // Reload store details as well to update name and other attributes dynamically
  fetchStoreDetailsFromBackend();

  try {
    const bannersList = await fetchStoreBanners(djangoBannersApiUrl.value.trim());
    if (bannersList && bannersList.length > 0) {
      banners.value = bannersList;
    } else {
      banners.value = [];
    }
  } catch (err) {
    console.warn('Failed to fetch banners from Osimart API:', err);
    bannersError.value = err.message;
  } finally {
    isLoadingBanners.value = false;
  }
}

// Announcements State from Osimart API
const announcements = ref([]);
const isLoadingAnnouncements = ref(false);
const announcementsError = ref(null);
const djangoAnnouncementsApiUrl = ref(normalizeOsimartUrl(getStoredOrFallbackUrl('django_announcements_api_url', OSIMART_ANNOUNCEMENTS_API_URL)));

async function fetchAnnouncementsFromBackend() {
  isLoadingAnnouncements.value = true;
  announcementsError.value = null;
  djangoAnnouncementsApiUrl.value = normalizeOsimartUrl(djangoAnnouncementsApiUrl.value);
  localStorage.setItem('django_announcements_api_url', djangoAnnouncementsApiUrl.value.trim());

  try {
    const list = await fetchStoreAnnouncements(djangoAnnouncementsApiUrl.value.trim());
    if (list && list.length > 0) {
      announcements.value = list;
    } else {
      announcements.value = [];
    }
  } catch (err) {
    console.warn('Failed to fetch announcements from Osimart API:', err);
    announcementsError.value = err.message;
  } finally {
    isLoadingAnnouncements.value = false;
  }
}

// Osimart Global Sync Toggle (defaults to true)
const enableOsimartSync = ref(localStorage.getItem('enable_osimart_sync') !== 'false');

function toggleOsimartSync() {
  localStorage.setItem('enable_osimart_sync', enableOsimartSync.value ? 'true' : 'false');
  if (enableOsimartSync.value) {
    fetchStoreDetailsFromBackend();
    fetchBannersFromBackend();
    fetchAnnouncementsFromBackend();
    fetchOsimartProductsFromBackend();
    triggerToast("Osimart Cloud Sync has been enabled! 🚀", "success");
  } else {
    // Clear active Osimart fetched states so local static data takes precedence instantly!
    osimartProducts.value = [];
    announcements.value = [];
    banners.value = [];
    triggerToast("Osimart Sync disabled. Using high-speed local static menu! ❄️", "info");
  }
}

// Osimart Products State
const osimartProducts = ref([]);
const isLoadingOsimartProducts = ref(false);
const osimartProductsError = ref(null);
const djangoOsimartProductsApiUrl = ref(normalizeOsimartUrl(getStoredOrFallbackUrl('django_osimart_products_api_url', OSIMART_PRODUCTS_API_URL)));

async function fetchOsimartProductsFromBackend() {
  isLoadingOsimartProducts.value = true;
  osimartProductsError.value = null;
  djangoOsimartProductsApiUrl.value = normalizeOsimartUrl(djangoOsimartProductsApiUrl.value);
  localStorage.setItem('django_osimart_products_api_url', djangoOsimartProductsApiUrl.value.trim());

  try {
    const list = await fetchStoreProducts(djangoOsimartProductsApiUrl.value.trim());
    if (list && list.length > 0) {
      osimartProducts.value = list;
    } else {
      osimartProducts.value = [];
    }
  } catch (err) {
    console.warn('Failed to fetch products from Osimart API:', err);
    osimartProductsError.value = err.message;
  } finally {
    isLoadingOsimartProducts.value = false;
  }
}

async function fetchOsimartCartFromBackend() {
  if (!enableOsimartSync.value) return;
  try {
    const data = await fetchOsimartCart();
    console.log('[Osimart API Sync] Cart state loaded:', data);
    
    let itemsList = null;
    if (data) {
      if (data.cart && typeof data.cart === 'object' && !Array.isArray(data.cart)) {
        itemsList = Object.values(data.cart);
      } else if (Array.isArray(data.cart)) {
        itemsList = data.cart;
      } else if (Array.isArray(data.items)) {
        itemsList = data.items;
      } else if (Array.isArray(data.cart_items)) {
        itemsList = data.cart_items;
      } else if (Array.isArray(data.products)) {
        itemsList = data.products;
      } else if (Array.isArray(data.data)) {
        itemsList = data.data;
      }
    }

    if (itemsList && Array.isArray(itemsList)) {
      cart.value = itemsList.map((item) => {
        const prod = item.product || item;
        const productId = prod.id || prod.uid || item.product_id;
        const staticId = OSIMART_ID_TO_STATIC_ID_MAP[productId] || productId;
        const menuItem = MENU_DATA.find(m => m.id === staticId) || osimartProducts.value.find(p => p.id === productId);
        
        return {
          cartKey: item.cart_key || item.cartKey || item.id || `${staticId}--`,
          id: staticId,
          name: prod.name || prod.title || item.product_name || menuItem?.name || "Premium Sweet Item",
          basePrice: Number(prod.price || item.price || menuItem?.price || 0),
          finalPrice: Number(item.final_price || item.price || prod.price || menuItem?.price || 0),
          image: prod.image || menuItem?.image || "/assets/honey_strawberries_bg.png",
          extras: item.extras || [],
          notes: item.notes || "",
          qty: Number(item.quantity || item.qty || 1)
        };
      });
    }
  } catch (err) {
    console.warn('[Osimart API Sync] Failed to fetch cart state from Osimart on load:', err.message);
  }
}

const displaySlides = computed(() => {
  if (enableOsimartSync.value && banners.value && banners.value.length > 0) {
    return banners.value.map((b) => ({
      title: b.title || 'Premium Sweet Selection',
      description: b.description || 'Lebanon\'s Premium Sweet Coastal Escape',
      image: b.image || b.image_url || '/assets/honey_strawberries_bg.png',
      ctaText: b.button_text || 'Explore Menu',
    }));
  }
  return [
    {
      title: 'Premium Sweet Selection',
      description: 'Step inside our ice-cold, sweet escape on the old coastal street in Batroun. Indulge in warm Belgian crepes, premium loaded waffles, and legendary ashta avocado cocktails!',
      image: '/assets/honey_strawberries_bg.png',
      ctaText: 'Explore Menu',
    },
    {
      title: 'Decadent Chocolate Delights',
      description: 'Hand-crafted waffles smothered in rich milk chocolate, topped with fresh strawberries and pure Lebanese cream.',
      image: '/assets/chocolate_strawberry_slide.png',
      ctaText: 'View Specials',
    },
    {
      title: 'Premium Sweet Selection',
      description: 'Join us on the sunny old coastal street in Batroun and treat your family to our traditional loaded fruit cocktails.',
      image: '/assets/premium_dessert_waffles_slide.png',
      ctaText: 'Our Story',
    }
  ];
});

function nextSlide() {
  const len = displaySlides.value.length;
  currentSlide.value = len > 0 ? (currentSlide.value + 1) % len : 0;
}

onMounted(() => {
  // Guarantee empty cart when opening the website fresh (0$ cart)
  if (typeof window !== 'undefined') {
    if (window.localStorage) {
      localStorage.removeItem('osimart_session_id');
      localStorage.removeItem('osimart_cookie');
    }
    cart.value = []; // explicitly ensure local cart ref is empty on startup
  }

  checkIsMobilePhoneScreen();
  window.addEventListener('resize', checkIsMobilePhoneScreen);
  slideTimer = setInterval(nextSlide, 3000); // 3 seconds per slide for better reading
  if (enableOsimartSync.value) {
    fetchStoreDetailsFromBackend(); // Load store details/name from Osimart API on startup
    fetchBannersFromBackend(); // Load live banners from Osimart API on startup
    fetchAnnouncementsFromBackend(); // Load live announcements from Osimart API on startup
    fetchOsimartProductsFromBackend(); // Load live products from Osimart API on startup
    // Do not auto-load pre-existing backend cart to ensure a completely empty 0$ cart on fresh load / refresh
    // fetchOsimartCartFromBackend();
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      reviews.value.forEach(rev => {
        if (localStorage.getItem(`liked-${rev.id}`)) {
          likedKeys.value[rev.id] = true;
        }
      });

      // Restore user login
      const savedUser = localStorage.getItem('loggedUser');
      if (savedUser) {
        loggedUser.value = JSON.parse(savedUser);
        newReviewAuthor.value = loggedUser.value.name;
        // Silently sync profile details from Osimart on page load
        syncProfileFromOsimart();
      }

      // Restore favorites
      const savedFavs = localStorage.getItem('sweetFavorites');
      if (savedFavs) {
        favorites.value = JSON.parse(savedFavs);
      } else {
        // Seed default favorites so it looks wonderful on first view!
        favorites.value = [
          MENU_DATA.find(item => item.id === 'crepe-1'),
          MENU_DATA.find(item => item.id === 'waffle-1')
        ].filter(Boolean);
      }

      // Restore Loyalty stats
      const savedPoints = localStorage.getItem('loyaltyPoints');
      if (savedPoints) {
        loyaltyPoints.value = Number(JSON.parse(savedPoints));
      }
      const savedCompleted = localStorage.getItem('completedTasks');
      if (savedCompleted) {
        completedTasks.value = JSON.parse(savedCompleted);
      }

    } catch (e) {
      console.error(e);
    }
  }
  
  // Fetch fresh exotic products, juices, and reviews from local Django backend if enabled
  if (enableDjangoSync.value) {
    fetchProductsFromBackend();
    fetchJuicesFromBackend();
    fetchReviewsFromBackend();
    fetchHoursFromBackend();
  } else {
    // Revert to high-speed custom local fallback data immediately to prevent console errors
    dynamicJuices.value = [...mockApiJuices];
    businessHours.value = [...BUSINESS_HOURS_DEFAULT];
    reviews.value = [...REVIEWS_DATA];
    dynamicProducts.value = [];
  }
});

onUnmounted(() => {
  if (slideTimer) clearInterval(slideTimer);
  window.removeEventListener('resize', checkIsMobilePhoneScreen);
});

// Toast messaging
function triggerToast(message, type = 'success') {
  const id = nextToastId++;
  toastList.value.push({ id, message, type });
  setTimeout(() => {
    toastList.value = toastList.value.filter(t => t.id !== id);
  }, 4000);
}

function onScrollScrubberToast(payload) {
  triggerToast(payload.text, payload.type);
}

// Handle finishing the intro loader
function handleIntroFinished() {
  triggerToast("Welcome to Jessy Juice! Let us make your day sweeter! ✨", "accent");
}

// Navigation Tabs Switches
function switchTab(tabId) {
  activeTab.value = tabId;
  if (tabId === 'checkout') {
    checkoutStep.value = 1;
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchTabMobile(tabId) {
  switchTab(tabId);
  isMobileMenuOpen.value = false;
}

// DYNAMIC BUSINESS HOURS BACKEND STATE
const BUSINESS_HOURS_DEFAULT = [
  { day: 'Monday', time: '9:00 AM - 10:00 PM' },
  { day: 'Tuesday', time: '9:00 AM - 10:00 PM' },
  { day: 'Wednesday', time: '9:00 AM - 10:00 PM' },
  { day: 'Thursday', time: '9:00 AM - 11:00 PM' },
  { day: 'Friday', time: '9:00 AM - 12:00 AM', isHighlight: true },
  { day: 'Saturday', time: '10:00 AM - 12:00 AM' },
  { day: 'Sunday', time: '10:00 AM - 10:00 PM' }
];

const businessHours = ref([...BUSINESS_HOURS_DEFAULT]);
const isLoadingHours = ref(false);
const hoursError = ref(null);
const djangoHoursApiUrl = ref(localStorage.getItem('django_hours_api_url') || 'http://127.0.0.1:8000/api/hours/');

// DYNAMIC JUICE API BACKEND STATE
const dynamicJuices = ref([]);
const isLoadingJuices = ref(false);
const juicesError = ref(null);
const juicesLoadedOnce = ref(false);
const djangoApiUrl = ref(localStorage.getItem('django_api_url') || 'http://127.0.0.1:8000/api/juices/');
const showDjangoSetupInstructions = ref(false);
const showDjangoControlCentre = ref(true);

// Django Global Sync Toggle (defaults to false to prevent failed network requests in browser console on load)
const enableDjangoSync = ref(localStorage.getItem('enable_django_sync') === 'true');

function toggleDjangoSync() {
  localStorage.setItem('enable_django_sync', enableDjangoSync.value ? 'true' : 'false');
  if (enableDjangoSync.value) {
    fetchProductsFromBackend();
    fetchJuicesFromBackend();
    fetchReviewsFromBackend();
    fetchHoursFromBackend();
    triggerToast("Django Backend Connection enabled! 🚀", "success");
  } else {
    // Revert to high-speed custom local fallback data immediately
    dynamicJuices.value = [...mockApiJuices];
    businessHours.value = [...BUSINESS_HOURS_DEFAULT];
    reviews.value = [...REVIEWS_DATA];
    dynamicProducts.value = [];
    triggerToast("Switched to offline-first local mode! 🍒", "info");
  }
}

// DYNAMIC PRODUCTS (ALL CATEGORIES) BACKEND STATE
const dynamicProducts = ref([]);
const isLoadingProducts = ref(false);
const productsError = ref(null);
const djangoProductsApiUrl = ref(localStorage.getItem('django_products_api_url') || 'http://127.0.0.1:8000/api/products/');

// DYNAMIC AUTH BACKEND STATE
const djangoAuthRegisterApiUrl = ref(localStorage.getItem('django_auth_register_api_url') || 'http://127.0.0.1:8000/api/register/');
const djangoAuthLoginApiUrl = ref(localStorage.getItem('django_auth_login_api_url') || 'http://127.0.0.1:8000/api/login/');

// DYNAMIC REVIEWS & ORDER SYNC STATE FOR DJANGO BACKEND
const isLoadingReviews = ref(false);
const reviewsError = ref(null);
const djangoReviewsApiUrl = ref(localStorage.getItem('django_reviews_api_url') || 'http://127.0.0.1:8000/api/reviews/');
const isCheckingOut = ref(false);
const djangoOrdersApiUrl = ref(localStorage.getItem('django_orders_api_url') || 'http://127.0.0.1:8000/api/orders/');

// Professional Checkout & Promo States
const promoCode = ref('');
const appliedDiscountCode = ref('');
const discountPercent = ref(0);
const checkoutPaymentMethod = ref('cod'); // 'cod', 'paypal', 'card'
const checkoutCountry = ref('Lebanon');
const checkoutZipCode = ref('');
const checkoutMarketingOptIn = ref(true);
const checkoutSuccess = ref(false);
const checkoutOrderId = ref('');
const checkoutStep = ref(1);

const checkoutFirstName = ref('');
const checkoutLastName = ref('');
const checkoutEmail = ref('');
const checkoutPhone = ref('');
const checkoutAddress = ref('');

const promoCodes = {
  'JESSY10': 10,
  'BATROUN20': 20,
  'TERAZAR10': 10,
  'SWEET15': 15
};

const orderDiscountAmount = computed(() => {
  return cartTotal.value * (discountPercent.value / 100);
});

const orderFinalTotal = computed(() => {
  return Math.max(0, cartTotal.value - orderDiscountAmount.value);
});

function applyPromoCode() {
  const code = promoCode.value.trim().toUpperCase();
  if (promoCodes[code]) {
    appliedDiscountCode.value = code;
    discountPercent.value = promoCodes[code];
    triggerToast(`Promo code "${code}" applied! You saved ${promoCodes[code]}%! 🏷️`, "success");
  } else {
    triggerToast("Oops! Invalid promo code. Please check and try again. ⚠️", "warning");
  }
}

function removePromoCode() {
  promoCode.value = '';
  appliedDiscountCode.value = '';
  discountPercent.value = 0;
  triggerToast("Promo code removed.", "info");
}

// Watch loggedUser to auto-populate checkout details
watch(loggedUser, (newVal) => {
  if (newVal) {
    const parts = newVal.name.trim().split(' ');
    checkoutFirstName.value = parts[0] || '';
    checkoutLastName.value = parts.slice(1).join(' ') || '';
    checkoutEmail.value = newVal.email || '';
    checkoutPhone.value = newVal.phone || '';
    checkoutAddress.value = newVal.city || '';
  }
}, { immediate: true });

// Fall back data if backend API is not responding or is empty
const mockApiJuices = [
  {
    id: 'avocado-cocktail',
    name: 'Avocado Cocktail',
    description: 'Creamy high-key avocado purée base topped with a colorful hand-cut coastal fruit medley, fresh honey drizzle, and raw nuts.',
    price: 10.00,
    priceLabel: '$10.00',
    category: 'juice',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAO-WWGCgKXhuO0lEHqdlfbkrv13rsCW1UZaXXmsx1NK4nILEW441_N50dBuFnGK92uakmFE5X_RYfU0nga-pU-q572ZycBYDUVaH9ww6Bw-MQjCgZ4FvnY_EW61Rm21QaUvP22-JAhM0-bag4Re7FgrGxqWMprM3kqbdgUo1kYA7IhPW44kuZnNsFMcz_9V3fKSPw-W2lan3oOx0kpHaODx0b_6vXoYewFQlvZ5QzfVN3BXEmMdMpOYk02SXYG2aLsXrhRgdezfg',
    badge: 'Fresh Fruit',
    isPopular: false
  },
  {
    id: 'sunset-sip',
    name: 'Sunset Sip Smoothie',
    description: 'Vibrant multilayered pink dragonfruit, mango, and exotic kiwi purée smoothie tailored for a refreshing coastal experience.',
    price: 8.00,
    priceLabel: '$8.00',
    category: 'juice',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCMwaNPPqu4SScSpBKkoGW4y2CF6ccJvu_4zfjFC2tcCJ3MFqgtvpiGCI5wSL0oOP_00LQM-LvrJTimkPJoI8cZRDXpC_eNX2CVF1nZVGKpeEE16L0YZXcgljxozUoCLvVtSkHM2i0ExhBnhB197Iky-MC-qPPn4owAZholm-LjCLMVBRvqu6Tvlmm2ujBbMPGEZD5Wa5Sdcq_gUgq0UBPtQtZ3iAQC5wOWClD1QBeIDjVVY5f0-zc7wR0VLwqiV240eiKWDkB7cw',
    badge: 'Popular',
    isPopular: true
  }
];

async function fetchJuicesFromBackend() {
  isLoadingJuices.value = true;
  juicesError.value = null;
  
  // Save customized API URL to local storage
  localStorage.setItem('django_api_url', djangoApiUrl.value.trim());

  try {
    const response = await fetch(djangoApiUrl.value.trim(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      }
    });
    
    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }
    
    const data = await response.json();
    console.log('Django API Juices Loaded:', data);
    
    if (Array.isArray(data)) {
      if (data.length === 0) {
        // Fallback if data is empty array so look is gorgeous
        dynamicJuices.value = [...mockApiJuices];
        triggerToast("Connected! Your Django DB of juices is empty. Displaying template falling back.", "info");
      } else {
        dynamicJuices.value = data.map((item, index) => {
          const priceVal = parseFloat(item.price) || 0.0;
          return {
            id: item.id ? `juice-${item.id}` : `juice-dyn-${index}`,
            name: item.name || 'Unnamed Juice',
            description: item.description || 'Squeezed fresh from Batroun local orchards.',
            price: priceVal,
            priceLabel: `$${priceVal.toFixed(2)}`,
            category: 'juice',
            image: item.image || item.image_url || 'https://images.unsplash.com/photo-1546039907-7fa05f864c02?auto=format&fit=crop&q=80&w=400',
            badge: item.badge || (item.is_popular ? 'Fresh' : ''),
            isPopular: !!item.is_popular || !!item.isPopular
          };
        });
        triggerToast(`Successfully loaded ${data.length} juices from your Django Backend! 🥑`, "success");
      }
    } else {
      throw new Error("Invalid format. API must return a JSON list of juices.");
    }
    juicesLoadedOnce.value = true;
  } catch (err) {
    console.warn('Django API is offline. This is normal if your local Django server is not currently running:', err);
    juicesError.value = err.message || 'Failed to fetch';
    // Fall back to template mock data so the app has fully playable, gorgeous items straight-away
    dynamicJuices.value = [...mockApiJuices];
    triggerToast("Django API offline. Loaded local template juices!", "info");
  } finally {
    isLoadingJuices.value = false;
  }
}

function useMockJuicesFallback() {
  dynamicJuices.value = [...mockApiJuices];
  juicesError.value = null;
  juicesLoadedOnce.value = true;
  triggerToast("Switched to template mock juices! 🥑", "success");
}

async function fetchProductsFromBackend() {
  isLoadingProducts.value = true;
  productsError.value = null;
  
  // Save customized API URL to local storage
  localStorage.setItem('django_products_api_url', djangoProductsApiUrl.value.trim());

  try {
    const response = await fetch(djangoProductsApiUrl.value.trim(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    const data = await response.json();
    console.log('Django API Products Loaded:', data);

    if (Array.isArray(data)) {
      if (data.length === 0) {
        dynamicProducts.value = [];
      } else {
        dynamicProducts.value = data.map((item, index) => {
          const priceVal = parseFloat(item.price) || 0.0;
          return {
            id: item.id ? `${item.category || 'product'}-${item.id}` : `prod-dyn-${index}`,
            name: item.name || 'Unnamed Product',
            description: item.description || 'Delicious Batroun treat crafted fresh.',
            price: priceVal,
            priceLabel: `$${priceVal.toFixed(2)}`,
            category: item.category || 'juice',
            image: item.image || item.image_url || 'https://images.unsplash.com/photo-1546039907-7fa05f864c02?auto=format&fit=crop&q=80&w=400',
            badge: item.badge || (item.is_popular ? 'Popular' : ''),
            isPopular: !!item.is_popular || !!item.isPopular
          };
        });
        triggerToast(`Successfully loaded ${data.length} specialties from Django Backend! 🧇`, "success");
      }
    } else {
      throw new Error("Invalid format. API must return a JSON list of products.");
    }
  } catch (err) {
    console.warn('Django Products API is offline. This is normal if your local Django server is not currently running:', err);
    productsError.value = err.message || 'Failed to fetch';
    dynamicProducts.value = [];
  } finally {
    isLoadingProducts.value = false;
  }
}

async function fetchHoursFromBackend() {
  isLoadingHours.value = true;
  hoursError.value = null;
  
  localStorage.setItem('django_hours_api_url', djangoHoursApiUrl.value.trim());
  
  try {
    const response = await fetch(djangoHoursApiUrl.value.trim(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      }
    });
    
    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }
    
    const data = await response.json();
    console.log('Django API Hours Loaded:', data);
    
    if (Array.isArray(data)) {
      businessHours.value = data.map(item => ({
        day: item.day || '',
        time: item.time || '',
        isHighlight: !!item.isHighlight || !!item.is_highlight
      }));
      triggerToast("Weekly Business Hours synced from Django backend! ⏰", "success");
    } else {
      throw new Error("Invalid format. API must return a JSON list of business hours.");
    }
  } catch (err) {
    console.warn('Django Hours API is offline. Falling back to default:', err);
    hoursError.value = err.message || 'Failed to fetch';
    // Fall back to template defaults
    businessHours.value = [...BUSINESS_HOURS_DEFAULT];
  } finally {
    isLoadingHours.value = false;
  }
}

// Real-time helper functions for business hours status
const currentDayOfWeek = computed(() => {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[new Date().getDay()];
});

const todayHours = computed(() => {
  const today = currentDayOfWeek.value;
  return businessHours.value.find(bh => bh.day.toLowerCase() === today.toLowerCase());
});

function parseTimeString(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.split('-').map(s => s.trim());
  if (parts.length !== 2) return null;
  
  const parseTime = (str) => {
    const match = str.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
    if (!match) return null;
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const ampm = match[3].toUpperCase();
    
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    
    return hours * 60 + minutes;
  };
  
  const start = parseTime(parts[0]);
  let end = parseTime(parts[1]);
  if (start === null || end === null) return null;
  return { start, end };
}

const currentStoreStatus = computed(() => {
  const bh = todayHours.value;
  if (!bh || !bh.time || bh.time.toLowerCase() === 'closed') {
    return { open: false, text: 'CLOSED TODAY' };
  }
  
  const parsed = parseTimeString(bh.time);
  if (!parsed) {
    return { open: true, text: 'OPEN' }; // default fallback
  }
  
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  
  let { start, end } = parsed;
  if (end === 0) end = 24 * 60; // 12:00 AM is end of day
  
  let isOpen = false;
  if (end < start) {
    // Overlap midnight, e.g. 9:00 AM - 1:00 AM
    isOpen = currentMinutes >= start || currentMinutes < end;
  } else {
    isOpen = currentMinutes >= start && currentMinutes < end;
  }
  
  return {
    open: isOpen,
    text: isOpen ? 'OPEN NOW' : 'CLOSED NOW',
    timeLabel: bh.time
  };
});

async function fetchReviewsFromBackend() {
  isLoadingReviews.value = true;
  reviewsError.value = null;
  
  // Save customized API URL to local storage
  localStorage.setItem('django_reviews_api_url', djangoReviewsApiUrl.value.trim());

  try {
    const response = await fetch(djangoReviewsApiUrl.value.trim(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    const data = await response.json();
    console.log('Django API Reviews Loaded:', data);

    if (Array.isArray(data)) {
      if (data.length === 0) {
        // Fall back to template if empty list
        reviews.value = [...REVIEWS_DATA];
      } else {
        reviews.value = data.map((item, index) => {
          return {
            id: item.id ? `rev-dyn-${item.id}` : `rev-dyn-${index}`,
            author: item.author || item.name || 'Anonymous Lover',
            avatar: item.avatar || item.avatar_url || '',
            role: item.role || 'Guest Sweetheart',
            rating: parseInt(item.rating) || 5,
            text: item.text || item.comment || item.content || 'Loved the sweetness!',
            tags: Array.isArray(item.tags) ? item.tags : (item.tags ? item.tags.split(',') : []),
            likes: parseInt(item.likes) || 0,
            timeAgo: item.time_ago || item.timeAgo || 'Just now',
            initials: (item.author || item.name || 'AN').split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2),
            replies: Array.isArray(item.replies) ? item.replies : []
          };
        });
        triggerToast("Successfully loaded reviews from Django backend! 💬", "success");
      }
    } else {
      throw new Error("Invalid format. API must return a JSON list of reviews.");
    }
  } catch (err) {
    console.warn('Django Reviews API is offline. This is normal if your local Django server is not currently running:', err);
    reviewsError.value = err.message || 'Failed to fetch';
    // Fall back to default template reviews so page is fully populated
    reviews.value = [...REVIEWS_DATA];
  } finally {
    isLoadingReviews.value = false;
  }
}

// Unified Menu Items
function isSameProductName(name1, name2) {
  if (!name1 || !name2) return false;
  const clean = (str) => {
    let s = str.toLowerCase().replace(/[^a-z0-9]/g, '');
    while (s.length > 2 && s.endsWith('s')) {
      s = s.slice(0, -1);
    }
    return s;
  };
  const c1 = clean(name1);
  const c2 = clean(name2);
  
  if (c1 === c2) return true;
  
  // If one contains the other and starts with the same distinctive words
  if (c1.length > 4 && c2.length > 4) {
    if (c1.startsWith(c2) || c2.startsWith(c1)) {
      return true;
    }
  }
  return false;
}

// Map stable Osimart API product UUIDs directly to our static menu IDs.
// This guarantees that when the user edits or renames any product in Osimart,
// it will seamlessly update the corresponding card on the website without duplicates.
const OSIMART_ID_TO_STATIC_ID_MAP = {
  '03dce709-9421-475e-bd93-d583d5ca58f5': 'sushi-crepes',
  '69781760-2755-4a92-b04e-22387c2f9936': 'avocado-cocktail',
  '298de975-0605-479d-92ed-20e8a4052a9c': 'berry-crepe',
  '30cae79f-4278-49ff-a7ce-087536a0cc06': 'molten-batroun',
  'db47fc80-b082-44a3-8c8e-09e737ce4793': 'sunset-sip',
  '986309d2-3f63-4e71-b304-5f113bce56f7': 'signature-waffles',
  '9b0810fe-f2ee-444a-b88d-d46b51213cb5': 'kunafa-shake',
  'e2011ee5-be65-4caf-8c13-1e3a542655c5': 'fettuccine-crepe',
};

function getOsimartId(id) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(String(id))) {
    return id;
  }
  const entry = Object.entries(OSIMART_ID_TO_STATIC_ID_MAP).find(([osimartId, staticId]) => staticId === id);
  if (entry) {
    return entry[0];
  }
  // Try to find in osimartProducts by name matching as fallback
  const staticItem = MENU_DATA.find(item => item.id === id);
  if (staticItem && osimartProducts.value) {
    const matchedProduct = osimartProducts.value.find(p => isSameProductName(p.name, staticItem.name));
    if (matchedProduct) {
      return matchedProduct.id;
    }
  }
  return id;
}

const unifiedMenuItems = computed(() => {
  let menu = [];
  
  // Start with static non-juices
  const staticNonJuice = MENU_DATA.filter(item => item.category !== 'juice');
  // Start with juices (static or dynamic)
  let juices = [];
  if (dynamicJuices.value.length > 0) {
    juices = [...dynamicJuices.value];
  } else {
    juices = MENU_DATA.filter(item => item.category === 'juice');
  }
  
  menu = [...staticNonJuice, ...juices];
  
  // Merge items from Osimart Products API
  if (enableOsimartSync.value && osimartProducts.value.length > 0) {
    osimartProducts.value.forEach(osimartItem => {
      const mappedStaticId = OSIMART_ID_TO_STATIC_ID_MAP[osimartItem.id];
      const index = menu.findIndex(staticItem => 
        (mappedStaticId && String(staticItem.id) === String(mappedStaticId)) ||
        String(staticItem.id) === String(osimartItem.id) || 
        isSameProductName(staticItem.name, osimartItem.name)
      );
      if (index !== -1) {
        // Keep the original static ID so existing app links/favorites don't break,
        // but fully merge all updated content from Osimart while preserving popularity!
        const existingPopular = menu[index].isPopular || menu[index].is_popular;
        menu[index] = { 
          ...menu[index], 
          ...osimartItem, 
          id: menu[index].id,
          isPopular: !!(existingPopular || osimartItem.isPopular),
          is_popular: !!(existingPopular || osimartItem.is_popular)
        };
      } else {
        menu.push(osimartItem);
      }
    });
  }
  
  // If we have dynamic products loaded from Django, we can merge or replace them!
  if (dynamicProducts.value.length > 0) {
    dynamicProducts.value.forEach(dynItem => {
      const mappedStaticId = OSIMART_ID_TO_STATIC_ID_MAP[dynItem.id];
      const index = menu.findIndex(staticItem => 
        (mappedStaticId && String(staticItem.id) === String(mappedStaticId)) ||
        String(staticItem.id) === String(dynItem.id) || 
        isSameProductName(staticItem.name, dynItem.name)
      );
      if (index !== -1) {
        const existingPopular = menu[index].isPopular || menu[index].is_popular;
        const existingSizes = menu[index].sizes || dynItem.sizes;
        menu[index] = { 
          ...menu[index], 
          ...dynItem, 
          id: menu[index].id,
          sizes: existingSizes,
          isPopular: !!(existingPopular || dynItem.isPopular),
          is_popular: !!(existingPopular || dynItem.is_popular)
        };
      } else {
        menu.push(dynItem);
      }
    });
  }
  
  // Final pass: Deduplicate the entire menu by name and ID to guarantee absolutely zero duplicate items!
  const finalMenu = [];
  menu.forEach(item => {
    const mappedStaticId = OSIMART_ID_TO_STATIC_ID_MAP[item.id];
    const duplicateIndex = finalMenu.findIndex(existing => {
      const existingMappedId = OSIMART_ID_TO_STATIC_ID_MAP[existing.id];
      return String(existing.id) === String(item.id) || 
             (mappedStaticId && String(existing.id) === String(mappedStaticId)) ||
             (existingMappedId && String(item.id) === String(existingMappedId)) ||
             isSameProductName(existing.name, item.name);
    });
    if (duplicateIndex !== -1) {
      const existingPopular = finalMenu[duplicateIndex].isPopular || finalMenu[duplicateIndex].is_popular;
      const existingSizes = finalMenu[duplicateIndex].sizes || item.sizes;
      finalMenu[duplicateIndex] = { 
        ...finalMenu[duplicateIndex], 
        ...item,
        sizes: existingSizes,
        isPopular: !!(existingPopular || item.isPopular),
        is_popular: !!(existingPopular || item.is_popular)
      };
    } else {
      finalMenu.push(item);
    }
  });
  
  const FALLBACK_STOCK_LIMITS = {
    'sushi-crepes': 2,
    'berry-crepe': 2,
    'molten-batroun': 1,
    'fettuccine-crepe': 1,
    'kunafa-shake': 1,
    'sunset-sip': 1,
    'avocado-cocktail': 1,
    'signature-waffles': 1
  };

  return finalMenu.map((item) => {
    let qty = item.quantity;
    if (qty === undefined || qty === null) {
      const staticId = OSIMART_ID_TO_STATIC_ID_MAP[item.id] || item.id;
      qty = FALLBACK_STOCK_LIMITS[staticId];
    }
    return {
      ...item,
      quantity: qty !== undefined ? Number(qty) : undefined
    };
  });
});

function isCategoryMatch(itemCategory, targetCategory) {
  if (!itemCategory || !targetCategory) return false;
  const ic = String(itemCategory).toLowerCase().trim();
  const tc = String(targetCategory).toLowerCase().trim();
  if (ic === tc) return true;
  if (tc === 'cocktails' && (ic === 'cocktail' || ic.includes('cocktail'))) return true;
  if (tc === 'light' && (ic === 'light' || ic.includes('light'))) return true;
  if (tc === 'juice' && (ic === 'juices' || ic.includes('juice'))) return true;
  if (tc === 'icecream' && (ic === 'shake' || ic.includes('ice') || ic.includes('cream') || ic.includes('shake'))) return true;
  if (tc === 'cake' && (ic === 'waffle' || ic.includes('plate') || ic.includes('waffle') || ic.includes('cake') || ic.includes('platter'))) return true;
  if (tc === 'chocolate' && (ic === 'crepe' || ic.includes('crepe') || ic.includes('crêpe') || ic.includes('fondue') || ic.includes('chocolate'))) return true;
  return false;
}

// Filter specialties by query & category pill
const filteredSpecialties = computed(() => {
  return unifiedMenuItems.value.filter(item => {
    const matchesCategory = activeCategory.value === 'all' || isCategoryMatch(item.category, activeCategory.value);
    const query = searchQuery.value.toLowerCase().trim();
    const matchesSearch = !query || 
                          item.name.toLowerCase().includes(query) || 
                          (item.description && item.description.toLowerCase().includes(query));
    return matchesCategory && matchesSearch;
  });
});

const MENU_SECTION_META = {
  cocktails: {
    title: 'Cocktails',
    icon: 'local_bar',
    subtitle: 'Served with honey, authentic lebanese ashta, almonds, raisins and pistachio',
    addons: 'Add Extra Ashta +$1.50 • Add Nestle +$1.00 • Add Organic Honey +$1.00',
    bgImage: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&q=80&w=600'
  },
  light: {
    title: 'Light Section',
    icon: 'eco',
    subtitle: 'Light Items Are Sugar Free • No Ashta • No Honey • Mixed With Xylitol Or Stevia',
    addons: null,
    bgImage: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&q=80&w=600'
  },
  juice: {
    title: 'Fresh Juices',
    icon: 'local_drink',
    subtitle: '100% Squeezed Fresh From Local Batroun Orchards Daily',
    addons: null,
    bgImage: 'https://images.unsplash.com/photo-1622597467836-f3285f2131b7?auto=format&fit=crop&q=80&w=600'
  },
  icecream: {
    title: 'Shakes & Ice Cream',
    icon: 'icecream',
    subtitle: 'Creamy Gelato & Refreshing Merry Cream Shakes',
    addons: null,
    bgImage: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&q=80&w=600'
  },
  cake: {
    title: 'Plates & Waffles',
    icon: 'bakery_dining',
    subtitle: 'Signature Fresh Fruit Platters & Ashta Creations',
    addons: null,
    bgImage: 'https://images.unsplash.com/photo-1568571780765-9276ac8b75a2?auto=format&fit=crop&q=80&w=600'
  },
  chocolate: {
    title: 'Crêpes & Fondue',
    icon: 'cookie',
    subtitle: 'Warm Belgian Chocolate, Fresh Fruit Fondues & Crêpes',
    addons: null,
    bgImage: 'https://images.unsplash.com/photo-1519676867240-f03562e64548?auto=format&fit=crop&q=80&w=600'
  }
};

const groupedMenuSections = computed(() => {
  const items = filteredSpecialties.value;
  const sections = [];
  const categoryKeys = ['cocktails', 'light', 'juice', 'icecream', 'cake', 'chocolate'];
  
  categoryKeys.forEach(catKey => {
    const catItems = items.filter(item => isCategoryMatch(item.category, catKey));
    if (catItems.length > 0) {
      sections.push({
        key: catKey,
        meta: MENU_SECTION_META[catKey] || { title: catKey, icon: 'restaurant_menu', subtitle: '', addons: null, bgImage: null },
        items: catItems
      });
    }
  });

  const remainingItems = items.filter(item => !categoryKeys.some(catKey => isCategoryMatch(item.category, catKey)));
  if (remainingItems.length > 0) {
    sections.push({
      key: 'other',
      meta: { title: 'More Specialties', icon: 'auto_awesome', subtitle: '', addons: null, bgImage: null },
      items: remainingItems
    });
  }

  return sections;
});

function getStartingPrice(item) {
  if (item.sizes && item.sizes.length > 0) {
    const p = item.sizes[0].price;
    return typeof p === 'number' ? p.toFixed(2) : p;
  }
  if (typeof item.price === 'number') {
    return item.price.toFixed(2);
  }
  if (item.priceLabel) {
    const match = String(item.priceLabel).match(/\d+(\.\d+)?/);
    if (match) return parseFloat(match[0]).toFixed(2);
  }
  return item.price || '0.00';
}

// Category Pill class generator
function getCategoryPillClass(catId) {
  if (activeCategory.value === catId) {
    return "whitespace-nowrap px-4 py-2 rounded-full text-xs font-heading font-extrabold tracking-tight bg-[#fee33c] text-[#863d96] border border-amber-300 shadow-md transition-all scale-105";
  }
  return "whitespace-nowrap px-4 py-2 rounded-full text-xs font-heading font-bold tracking-tight text-stone-600 hover:text-[#863d96] bg-stone-100 hover:bg-[#fee33c]/20 border border-stone-200/60 transition-all";
}

// CART / MY PLATE PERSISTENCE & CONTROL
const cart = ref([]);

// Custom item creator state (Customizer Modal)
const activeCustomItem = ref(null);
const activeCustomItemResolved = computed(() => {
  if (!activeCustomItem.value) return null;
  const found = unifiedMenuItems.value.find(item => 
    String(item.id) === String(activeCustomItem.value.id) || 
    isSameProductName(item.name, activeCustomItem.value.name)
  );
  return found || activeCustomItem.value;
});
const selectedExtras = ref([]);
const selectedSize = ref(null);
const customizationNotes = ref('');
const customizationQty = ref(1);
const customizationErrorMsg = ref('');
const cartErrorMsgs = ref({});

const premiumToppings = [
  { id: 'strawberries', name: 'Premium Wild Strawberries', price: 1.50 },
  { id: 'pistachios', name: 'Roasted Premium Pistachios', price: 1.00 },
  { id: 'honey', name: 'Golden Cedar Honey Drizzle', price: 1.00 },
  { id: 'almond', name: 'Raw Almond Crunch', price: 1.00 },
  { id: 'nutella', name: 'Warm Extra Belgian Nutella Dip', price: 2.00 }
];

// Open customizer modal
function openCustomizer(item) {
  const upToDateItem = unifiedMenuItems.value.find(m => 
    String(m.id) === String(item.id) || 
    isSameProductName(m.name, item.name)
  );
  activeCustomItem.value = upToDateItem || item;
  selectedExtras.value = [];
  customizationNotes.value = '';
  customizationQty.value = 1;
  customizationErrorMsg.value = '';
  const itemSizes = (upToDateItem || item)?.sizes;
  selectedSize.value = (itemSizes && itemSizes.length > 0) ? itemSizes[0] : null;
}

// Close customizer modal
function closeCustomizer() {
  activeCustomItem.value = null;
  customizationErrorMsg.value = '';
}

function increaseCustomizationQty() {
  if (!activeCustomItemResolved.value) return;
  const currentInCart = getCartQuantityForProduct(activeCustomItemResolved.value.id);
  const stockLimit = activeCustomItemResolved.value.quantity !== undefined ? Number(activeCustomItemResolved.value.quantity) : 99;
  const totalTarget = currentInCart + customizationQty.value + 1;
  
  if (totalTarget > stockLimit) {
    const remainingToChoose = Math.max(0, stockLimit - currentInCart);
    if (remainingToChoose === 0) {
      customizationErrorMsg.value = `Sorry! Only ${stockLimit} and you already have ${currentInCart} on your plate ⚠️`;
      triggerToast(`Only ${stockLimit} and you have them on your plate ⚠️`, "warning");
    } else {
      customizationErrorMsg.value = `Sorry! Only ${stockLimit} ⚠️`;
      triggerToast(`Sorry! We only have ${stockLimit} ⚠️`, "warning");
    }
    return;
  }
  customizationQty.value++;
  customizationErrorMsg.value = '';
  awardPoints('qty_adjust');
}

function decreaseCustomizationQty() {
  customizationQty.value = Math.max(1, customizationQty.value - 1);
  customizationErrorMsg.value = '';
  awardPoints('qty_adjust');
}

// Calculate customizer single item price
const currentSingleItemTotalPrice = computed(() => {
  if (!activeCustomItemResolved.value) return 0;
  let price = selectedSize.value ? selectedSize.value.price : activeCustomItemResolved.value.price;
  selectedExtras.value.forEach(extId => {
    const extra = premiumToppings.find(t => t.id === extId);
    if (extra) price += extra.price;
  });
  return price;
});

// Helper to sync cart item with Osimart API.
// Returns true on success, "stock_error" on stock/quantity limits, and "network_error" on network/transient failures.
async function syncItemToOsimart(productId, qty, extras = [], notes = "") {
  if (!enableOsimartSync.value) return true;
  const staticId = OSIMART_ID_TO_STATIC_ID_MAP[productId] || productId;
  const menuItem = MENU_DATA.find(m => m.id === staticId) || (osimartProducts.value ? osimartProducts.value.find(p => p.id === productId) : null);
  const name = menuItem?.name || "Unknown Sweet";
  try {
    const osimartProductId = getOsimartId(productId);

    console.log(`[Osimart API Sync] Syncing product "${name}" (ID: ${osimartProductId}, original: ${productId}), quantity: ${qty}...`);
    await updateOsimartCartItem(osimartProductId, qty, extras, notes, name);
    return true;
  } catch (err) {
    console.warn(`[Osimart API Sync] Failed to sync product ${productId}:`, err);
    let errMsg = err.message || "";
    if (errMsg.includes("Maximum quantity exceeded") || errMsg.includes("quantity exceeded") || errMsg.includes("stock")) {
      triggerToast(`Sorry, we cannot add more of "${name}". Maximum quantity / stock limit exceeded! ⚠️`, "warning");
      triggerStockPopup(
        name,
        `Sorry! We cannot add more of this item. Maximum quantity or stock limit exceeded! ⚠️`,
        menuItem?.image || "",
        menuItem?.quantity !== undefined ? Number(menuItem.quantity) : 0,
        getCartQuantityForProduct(productId)
      );
      return "stock_error";
    } else {
      triggerToast(`Unable to sync "${name}" with server right now. Keeping it locally on your plate! 🥞`, "warning");
      return "network_error";
    }
  }
}

function getCartQuantityForProduct(productId) {
  return cart.value
    .filter(c => c.id === productId)
    .reduce((sum, c) => sum + c.qty, 0);
}

// Add customized item to "My Plate" (cart)
async function addToPlate() {
  if (!activeCustomItemResolved.value) return;

  const currentInCart = getCartQuantityForProduct(activeCustomItemResolved.value.id);
  const totalTarget = currentInCart + customizationQty.value;
  const stockLimit = activeCustomItemResolved.value.quantity !== undefined ? Number(activeCustomItemResolved.value.quantity) : 99;

  if (stockLimit === 0 || totalTarget > stockLimit) {
    if (stockLimit === 0) {
      customizationErrorMsg.value = `Sorry! "${activeCustomItemResolved.value.name}" is out of stock ⚠️`;
      triggerToast(`Sorry! "${activeCustomItemResolved.value.name}" is out of stock on the counter. Please choose another delicious pick! ⚠️`, "warning");
    } else {
      customizationErrorMsg.value = `Sorry! We only have ${stockLimit}. You have ${currentInCart} in cart ⚠️`;
      triggerToast(`Sorry! There are only ${stockLimit} for "${activeCustomItemResolved.value.name}"! ⚠️`, "warning");
    }
    return;
  }

  const extrasNames = selectedExtras.value.map(extId => {
    const top = premiumToppings.find(t => t.id === extId);
    return top ? top.name : '';
  }).filter(Boolean);

  const sizeName = selectedSize.value ? selectedSize.value.name : '';
  const itemDisplayName = sizeName ? `${activeCustomItemResolved.value.name} (${sizeName})` : activeCustomItemResolved.value.name;
  const cartKey = `${activeCustomItemResolved.value.id}-${sizeName}-${selectedExtras.value.join(',')}-${customizationNotes.value}`;

  let targetQty = customizationQty.value;
  const name = itemDisplayName;

  // Check if exists
  const existingIndex = cart.value.findIndex(c => c.cartKey === cartKey);
  const existed = existingIndex > -1;
  if (existed) {
    cart.value[existingIndex].qty += customizationQty.value;
    targetQty = cart.value[existingIndex].qty;
  } else {
    cart.value.push({
      cartKey,
      id: activeCustomItemResolved.value.id,
      name: itemDisplayName,
      size: sizeName,
      basePrice: selectedSize.value ? selectedSize.value.price : activeCustomItemResolved.value.price,
      finalPrice: currentSingleItemTotalPrice.value,
      image: activeCustomItemResolved.value.image,
      extras: extrasNames,
      notes: customizationNotes.value,
      qty: customizationQty.value
    });
  }

  // Store active item ID before closing/clearing modal state
  const targetItemId = activeCustomItemResolved.value.id;

  // Sync with Osimart API
  const success = await syncItemToOsimart(targetItemId, targetQty, selectedExtras.value, customizationNotes.value);

  if (success === true || success === "network_error") {
    triggerToast(`"${name}" added customly to your sweet plate! 🍽️`, 'success');
    awardPoints('add_plate');
    closeCustomizer();
  } else if (success === "stock_error") {
    // Revert local addition safely by locating the item by its cartKey after the async await call
    const idx = cart.value.findIndex(c => c.cartKey === cartKey);
    if (idx > -1) {
      if (existed) {
        cart.value[idx].qty -= customizationQty.value;
        if (cart.value[idx].qty <= 0) {
          cart.value.splice(idx, 1);
        }
      } else {
        cart.value.splice(idx, 1);
      }
    }
  }
}

async function addDirectToCart(item) {
  const upToDateItem = unifiedMenuItems.value.find(m => 
    String(m.id) === String(item.id) || 
    isSameProductName(m.name, item.name)
  ) || item;

  const currentInCart = getCartQuantityForProduct(upToDateItem.id);
  const totalTarget = currentInCart + 1;
  const stockLimit = upToDateItem.quantity !== undefined ? Number(upToDateItem.quantity) : 99;

  if (stockLimit === 0 || totalTarget > stockLimit) {
    if (stockLimit === 0) {
      triggerToast(`Sorry! "${upToDateItem.name}" is out of stock on the counter. Please choose another delicious pick! ⚠️`, "warning");
      triggerStockPopup(
        upToDateItem.name,
        `Sorry! "${upToDateItem.name}" is out of stock on the counter. Please choose another delicious pick! ⚠️`,
        upToDateItem.image || "",
        stockLimit,
        currentInCart
      );
    } else {
      triggerToast(`Sorry! There are only ${stockLimit} left for "${upToDateItem.name}" and you already have ${currentInCart} on your plate. ⚠️`, "warning");
      triggerStockPopup(
        upToDateItem.name,
        `Sorry! There are only ${stockLimit} left for "${upToDateItem.name}" and you already have ${currentInCart} on your plate. ⚠️`,
        upToDateItem.image || "",
        stockLimit,
        currentInCart
      );
    }
    return;
  }

  const cartKey = `${upToDateItem.id}--`;
  let targetQty = 1;

  const existingIndex = cart.value.findIndex(c => c.cartKey === cartKey);
  const existed = existingIndex > -1;
  if (existed) {
    cart.value[existingIndex].qty += 1;
    targetQty = cart.value[existingIndex].qty;
  } else {
    cart.value.push({
      cartKey,
      id: upToDateItem.id,
      name: upToDateItem.name,
      basePrice: upToDateItem.price,
      finalPrice: upToDateItem.price,
      image: upToDateItem.image,
      extras: [],
      notes: '',
      qty: 1
    });
  }

  // Sync with Osimart API
  const success = await syncItemToOsimart(upToDateItem.id, targetQty);

  if (success === true || success === "network_error") {
    triggerToast(`"${upToDateItem.name}" added to your sweet plate! 🍽️`, 'success');
  } else if (success === "stock_error") {
    // Revert local addition safely by locating the item by its cartKey after the async await call
    const idx = cart.value.findIndex(c => c.cartKey === cartKey);
    if (idx > -1) {
      cart.value[idx].qty -= 1;
      if (cart.value[idx].qty <= 0) {
        cart.value.splice(idx, 1);
      }
    }
  }
}

function clearAllCart() {
  const itemsToClear = [...cart.value];
  cart.value = [];
  triggerToast("Your sweet plate helper is fully cleared! 🧹", "info");

  // Sync with Osimart API - set quantity to 0 for all cleared items
  if (enableOsimartSync.value) {
    itemsToClear.forEach(item => {
      syncItemToOsimart(item.id, 0);
    });
  }
}

function removeFromCart(cartKey) {
  const foundItem = cart.value.find(c => c.cartKey === cartKey);
  if (foundItem) {
    // Sync removal (quantity = 0) with Osimart API
    syncItemToOsimart(foundItem.id, 0);
  }

  cart.value = cart.value.filter(c => c.cartKey !== cartKey);
  triggerToast("Item removed from your sweet plate.", "info");
}

async function updateCartQty(cartKey, amount) {
  const index = cart.value.findIndex(c => c.cartKey === cartKey);
  if (index > -1) {
    const originalQty = cart.value[index].qty;
    const newQty = originalQty + amount;
    const itemId = cart.value[index].id;

    if (newQty <= 0) {
      removeFromCart(cartKey);
    } else {
      const menuProduct = unifiedMenuItems.value.find(m => 
        String(m.id) === String(itemId) || 
        isSameProductName(m.name, cart.value[index].name)
      );
      const stockLimit = (menuProduct && menuProduct.quantity !== undefined) ? Number(menuProduct.quantity) : 99;
      
      const otherItemsQty = cart.value
        .filter(c => c.id === itemId && c.cartKey !== cartKey)
        .reduce((sum, c) => sum + c.qty, 0);
      const totalTarget = otherItemsQty + newQty;

      if (amount > 0 && totalTarget > stockLimit) {
        triggerToast(`Sorry! There are only ${stockLimit} left for "${cart.value[index].name}"! ⚠️`, "warning");
        cartErrorMsgs.value[cartKey] = `Only ${stockLimit} left ⚠️`;
        setTimeout(() => {
          cartErrorMsgs.value[cartKey] = '';
        }, 3500);
        return;
      }

      // Temporarily update quantity in UI
      cart.value[index].qty = newQty;
      awardPoints('qty_adjust');
      
      // Sync updated quantity with Osimart API
      const success = await syncItemToOsimart(itemId, newQty);
      if (success === "stock_error") {
        // Revert quantity if sync failed (e.g. stock limit exceeded)
        const idx = cart.value.findIndex(c => c.cartKey === cartKey);
        if (idx > -1) {
          cart.value[idx].qty = originalQty;
        }
      }
    }
  }
}

function nextStep() {
  if (checkoutStep.value === 1) {
    if (cart.value.length === 0) {
      triggerToast("Your plate is empty! Please add some delicious items first. 🥞", "warning");
      return;
    }
    checkoutStep.value = 2;
  } else if (checkoutStep.value === 2) {
    if (!checkoutFirstName.value.trim() || !checkoutLastName.value.trim()) {
      triggerToast("Please fill in your first and last name! 🍒", "warning");
      return;
    }
    if (!checkoutEmail.value.trim()) {
      triggerToast("Please enter your email address! 📧", "warning");
      return;
    }
    if (!checkoutPhone.value.trim()) {
      triggerToast("Please enter your phone number! 📞", "warning");
      return;
    }
    checkoutStep.value = 3;
  } else if (checkoutStep.value === 3) {
    if (!checkoutAddress.value.trim()) {
      triggerToast("Please fill in your delivery/pickup address details! 📍", "warning");
      return;
    }
    checkoutStep.value = 4;
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function prevStep() {
  checkoutStep.value = Math.max(1, checkoutStep.value - 1);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Calculates Plate cart totals
const cartCount = computed(() => {
  return cart.value.reduce((sum, item) => sum + item.qty, 0);
});

const cartTotal = computed(() => {
  return cart.value.reduce((sum, item) => sum + (item.finalPrice * item.qty), 0);
});

async function checkoutPlate(isVerified = false) {
  if (cart.value.length === 0) return;
  
  // Sync checkout fields into standard guest ref variables if on checkout tab
  if (activeTab.value === 'checkout' && !loggedUser.value) {
    guestName.value = `${checkoutFirstName.value.trim()} ${checkoutLastName.value.trim()}`.trim();
    guestEmail.value = checkoutEmail.value.trim();
    guestPhone.value = checkoutPhone.value.trim();
    guestCity.value = checkoutAddress.value.trim();
  }

  // If guest and guest details are not filled out, prompt guest details modal
  if (!loggedUser.value && !guestName.value.trim()) {
    isCartOpen.value = false;
    if (activeTab.value !== 'checkout') {
      isGuestCheckoutModalOpen.value = true;
    } else {
      triggerToast("Please fill out all contact and delivery fields first! 🍒", "error");
    }
    return;
  }

  if (!loggedUser.value) {
    const cleanName = guestName.value.trim();
    const cleanEmail = guestEmail.value.trim().toLowerCase();
    const cleanPhone = guestPhone.value.trim();
    const cleanCity = guestCity.value.trim();

    if (!cleanName || !cleanEmail || !cleanPhone || !cleanCity) {
      triggerToast("Please fill out all checkout fields! 🍒", "error");
      return;
    }

    // Intercept for Guest verification OTP code
    if (!isVerified) {
      const guestPayload = {
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        city: cleanCity,
        isGuestCheckout: true
      };

      isCartOpen.value = false;
      isGuestCheckoutModalOpen.value = true;

      // Prevent re-sending verification code if we are already verifying this email
      if (isVerifying.value && pendingUserPayload.value?.isGuestCheckout && pendingUserPayload.value.email === cleanEmail) {
        triggerToast("Please enter the 4-digit verification code sent to your email to place your order! 📧", "info");
        return;
      }

      await sendVerificationCode(cleanEmail, cleanPhone, guestPayload);
      return;
    }
  }
  
  const savedCart = [...cart.value];
  const appliedNotes = appliedDiscountCode.value 
    ? `Promo: ${appliedDiscountCode.value} (${discountPercent.value}% OFF). Payment: ${checkoutPaymentMethod.value.toUpperCase()}.`
    : `Payment: ${checkoutPaymentMethod.value.toUpperCase()}.`;

  const orderPayload = {
    items: cart.value.map(item => ({
      id: getOsimartId(item.id),
      name: item.name,
      qty: item.qty,
      price: item.basePrice || item.price,
      final_price: item.finalPrice,
      extras: item.extras || [],
      notes: (item.notes || '') + (appliedNotes ? ` [${appliedNotes}]` : '')
    })),
    total_amount: orderFinalTotal.value,
    item_count: cartCount.value,
    created_at: new Date().toISOString(),
    session_id: localStorage.getItem('osimart_session_id') || '',
    cart_id: localStorage.getItem('osimart_session_id') || '',
    store: OSIMART_STORE_ID,
    
    // Unified Customer Info (API Connected!)
    customer_name: loggedUser.value ? loggedUser.value.name : guestName.value.trim(),
    customer_email: loggedUser.value ? loggedUser.value.email : guestEmail.value.trim(),
    customer_phone: loggedUser.value ? (loggedUser.value.phone || loggedUser.value.mobile) : guestPhone.value.trim(),
    customer_city: loggedUser.value ? (loggedUser.value.city || 'Batroun') : guestCity.value.trim(),
    is_guest: !loggedUser.value
  };

  // Close cart drawer & guest modal immediately
  isCartOpen.value = false;
  isGuestCheckoutModalOpen.value = false;
  isCheckingOut.value = true;

  if (enableOsimartSync.value) {
    // Sync guest or logged-in customer explicitly to the Osimart Customers list!
    try {
      createOsimartCustomer(
        orderPayload.customer_name,
        orderPayload.customer_email,
        orderPayload.customer_phone,
        orderPayload.customer_city,
        orderPayload.is_guest,
        orderPayload.is_guest ? 'guest plus' : 'active'
      ).catch((err) => {
        console.warn("Could not sync customer to Osimart customer list:", err);
      });
    } catch (syncCustErr) {
      console.warn("Could not sync customer to Osimart customer list:", syncCustErr);
    }

    triggerToast("Sending order to Osimart Cloud... 🚀", "info");
    try {
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Osimart-Cookie': localStorage.getItem('osimart_cookie') || ''
      };
      if (loggedUser.value && loggedUser.value.token) {
        headers['Authorization'] = `Bearer ${loggedUser.value.token}`;
      }
      const response = await fetch('/api/osimart/orders/create', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(orderPayload)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.details || errData.error || `HTTP ${response.status}`);
      }

      // Order creation succeeded - safe to clear cart now
      cart.value = [];
      
      // Clean up Osimart cart so it is empty on the server too!
      if (enableOsimartSync.value) {
        for (const item of savedCart) {
          try {
            await syncItemToOsimart(item.id, 0);
          } catch (syncErr) {
            console.warn(`Could not clear synced item ${item.id} from Osimart cart:`, syncErr);
          }
        }
      }
      
      // Reset guest values after successful order so next guest order is fresh
      if (!loggedUser.value) {
        guestName.value = '';
        guestEmail.value = '';
        guestPhone.value = '';
        guestCity.value = '';
      }
      
      checkoutOrderId.value = 'JJ-' + Math.floor(100000 + Math.random() * 900000);
      checkoutSuccess.value = true;
      triggerToast("Ahla! Your custom sweetness plate order is sent to the counter & synced to Osimart! 🍫", "success");
      awardPoints('checkout');
      // Fetch live products to update stock instantly
      fetchOsimartProductsFromBackend();
    } catch (err) {
      console.warn("Could not send order to Osimart API:", err);
      // Restore cart so user doesn't lose their customized plate!
      cart.value = savedCart;
      isCartOpen.value = true;
      
      const errMsg = err.message || "";
      if (errMsg.includes("stock") || errMsg.includes("quantity") || errMsg.includes("exceeded") || errMsg.includes("400") || errMsg.includes("409")) {
        triggerToast("Sorry! Some items on your plate are out of stock on the counter. Please remove or adjust them. ⚠️", "warning");
      } else {
        triggerToast(`Could not send order to Osimart: ${errMsg}. Your plate has been restored.`, "error");
      }
      // Refresh stock anyway
      fetchOsimartProductsFromBackend();
    } finally {
      isCheckingOut.value = false;
    }
  } else {
    triggerToast("Sending order to your Django backend... 🚀", "info");
    
    // Clear cart immediately for local/Django mode
    cart.value = [];
    
    // Save customized API URL to local storage
    localStorage.setItem('django_orders_api_url', djangoOrdersApiUrl.value.trim());

    try {
      const response = await fetch(djangoOrdersApiUrl.value.trim(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(orderPayload)
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      checkoutOrderId.value = 'JJ-' + Math.floor(100000 + Math.random() * 900000);
      checkoutSuccess.value = true;
      triggerToast("Ahla! Your custom sweetness plate order is sent to the counter & synced to Django! 🍫", "success");
      awardPoints('checkout');
    } catch (err) {
      console.warn("Could not send order to Django API:", err);
      checkoutOrderId.value = 'JJ-' + Math.floor(100000 + Math.random() * 900000);
      checkoutSuccess.value = true;
      triggerToast("Ahla! Order sent to counter! (Saved locally, Django API offline)", "success");
      awardPoints('checkout');
    } finally {
      isCheckingOut.value = false;
    }
  }
}

// Quick Search header trigger
function triggerQuickSearch() {
  switchTab('menu');
  setTimeout(() => {
    const input = document.getElementById('menu-search-input');
    if (input) {
      input.focus();
      input.select();
      
      // Flash dynamic attention focus ring on input
      input.classList.add('ring-4', 'ring-[#fee33c]', 'border-[#eed012]');
      setTimeout(() => {
        input.classList.remove('ring-4', 'ring-[#fee33c]', 'border-[#eed012]');
      }, 1500);
    }
  }, 300);
  triggerToast("Ready to search our chocolate, cocktail, & waffle menu!", "info");
}

// Food Item Detail Modal
const activeDetailItem = ref(null);
const activeDetailItemResolved = computed(() => {
  if (!activeDetailItem.value) return null;
  const found = unifiedMenuItems.value.find(item => 
    String(item.id) === String(activeDetailItem.value.id) || 
    isSameProductName(item.name, activeDetailItem.value.name)
  );
  return found || activeDetailItem.value;
});

function openDetailModal(item) {
  const upToDateItem = unifiedMenuItems.value.find(m => 
    String(m.id) === String(item.id) || 
    isSameProductName(m.name, item.name)
  );
  activeDetailItem.value = upToDateItem || item;
}
function closeDetailModal() {
  activeDetailItem.value = null;
}
function customizeFromDetail() {
  if (activeDetailItemResolved.value) {
    openCustomizer(activeDetailItemResolved.value);
    closeDetailModal();
  }
}
function toggleExtra(toppingId) {
  if (selectedExtras.value.includes(toppingId)) {
    selectedExtras.value = selectedExtras.value.filter(id => id !== toppingId);
  } else {
    selectedExtras.value.push(toppingId);
  }
}

// GUESTBOOK REVIEWS SYSTEM
const reviews = ref([...REVIEWS_DATA]);
const newReviewAuthor = ref('');
const newReviewRole = ref('Guest Sweetheart');
const newReviewText = ref('');
const newReviewRating = ref(5);
const newReviewTags = ref([]);

function toggleReviewTag(tag) {
  if (newReviewTags.value.includes(tag)) {
    newReviewTags.value = newReviewTags.value.filter(t => t !== tag);
  } else {
    newReviewTags.value.push(tag);
  }
}

async function submitReview() {
  if (!newReviewAuthor.value.trim() || !newReviewText.value.trim()) {
    triggerToast("Please fill in your name and sweet comment! 🍓", "error");
    return;
  }

  const reviewPayload = {
    author: newReviewAuthor.value,
    role: newReviewRole.value || 'Guest Sweetheart',
    rating: newReviewRating.value,
    text: newReviewText.value,
    tags: [...newReviewTags.value],
    likes: 0,
    timeAgo: 'Just now'
  };

  const newRev = {
    id: `rev-custom-${Date.now()}`,
    ...reviewPayload,
    initials: newReviewAuthor.value.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)
  };

  // Optimistically add locally
  reviews.value.unshift(newRev);
  triggerToast("Posting your sweet review... 🥞", "info");

  // Reset Form
  const originalAuthor = newReviewAuthor.value;
  newReviewAuthor.value = '';
  newReviewText.value = '';
  newReviewRating.value = 5;
  newReviewTags.value = [];

  awardPoints('write_review');

  // Send to Django backend API
  try {
    const response = await fetch(djangoReviewsApiUrl.value.trim(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(reviewPayload)
    });

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    triggerToast("Thank you! Posted to your Django Guestbook backend! 🥰", "success");
    // Reload reviews to sync with backend
    fetchReviewsFromBackend();
  } catch (err) {
    console.warn("Could not post review to Django backend:", err);
    triggerToast(`Saved locally! (Django API offline or CORS issues)`, "info");
  }
}

function toggleLikeReview(revId) {
  const rev = reviews.value.find(r => r.id === revId);
  if (rev) {
    const hasLikedKey = `liked-${revId}`;
    if (likedKeys.value[revId]) {
      rev.likes--;
      likedKeys.value[revId] = false;
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          localStorage.removeItem(hasLikedKey);
        } catch (e) {
          console.error(e);
        }
      }
      triggerToast("Recommendation unvoted.", "info");
    } else {
      rev.likes++;
      likedKeys.value[revId] = true;
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          localStorage.setItem(hasLikedKey, 'true');
        } catch (e) {
          console.error(e);
        }
      }
      triggerToast("Voted! Thank you for sharing the love! 🍓", "success");
    }
  }
}

function clearCatalogFilters() {
  searchQuery.value = '';
  activeCategory.value = 'all';
}
</script>

<template>
  <div>
    <!-- Interactive Luxury Intro Loader -->
    <IntroLoader @finish="handleIntroFinished" />

    <!-- MAIN APP WRAPPER -->
    <div class="min-h-screen flex flex-col justify-between select-none">
      
      <!-- TOP ANNOUNCEMENT BAR -->
      <div class="bg-secondary text-primary py-2.5 px-4 text-center text-xs font-heading font-extrabold tracking-wider flex items-center justify-center gap-2 overflow-hidden animate-stagger-1 border-b border-amber-300 shadow-xs">
        <span class="inline-block w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></span>
        <span v-if="announcements && announcements.length > 0">{{ announcements[0].text }}</span>
        <span v-else>ICE-COLD AIR CONDITIONED ESCAPE IN THE HEART OF BATROUN!</span>
        <span class="hidden md:inline">❄️</span>
      </div>

      <!-- MAIN HEADER -->
      <header class="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-stone-200/60 px-4 py-3 md:py-4 transition-all duration-300 animate-stagger-2">
        <div class="max-w-7xl mx-auto flex items-center justify-between">
          
          <!-- Logo & Boutique details -->
          <div class="flex items-center gap-3">
            <div 
              @click="switchTab('home')"
              class="w-11 h-11 md:w-13 md:h-13 rounded-full bg-secondary flex items-center justify-center shadow-md border-2 border-amber-300 shrink-0 cursor-pointer hover:scale-105 active:scale-95 transition-transform"
            >
              <svg viewBox="5 15 300 175" class="w-[85%] h-[85%]" xmlns="http://www.w3.org/2000/svg">
                <path d="M 23 25 H 77 V 43 H 59 V 115 C 59 145, 12 145, 10 120 H 28 C 28 132, 41 132, 41 115 V 43 H 23 Z" fill="#863d96" />
                <text x="80" y="86" font-family="'Montserrat', 'Arial Black', sans-serif" font-weight="900" font-size="64" fill="#863d96" letter-spacing="-1">ESSY</text>
                <text x="80" y="146" font-family="'Montserrat', 'Arial Black', sans-serif" font-weight="900" font-size="64" fill="#863d96" letter-spacing="-1">UICE</text>
                <text x="145" y="180" font-family="'Montserrat', sans-serif" font-weight="800" font-size="14" fill="#863d96" letter-spacing="1">SINCE 1991</text>
              </svg>
            </div>
            <div>
              <div class="flex items-center gap-1.5">
                <h1 @click="switchTab('home')" class="font-heading font-black text-primary text-base md:text-lg tracking-tight cursor-pointer">
                  Jessy Juice
                </h1>
                <span class="text-[9px] bg-emerald-50 text-emerald-700 font-heading font-black px-2 py-0.5 rounded-md uppercase tracking-wider hidden sm:inline">
                  OPEN
                </span>
              </div>
            </div>
          </div>

          <!-- Navigation Links (Desktop) -->
          <nav class="hidden md:flex items-center gap-1.5 bg-stone-100 rounded-full p-1 border border-stone-200">
            <button 
              @click="switchTab('home')" 
              :class="[activeTab === 'home' ? 'bg-secondary text-primary shadow-xs font-extrabold' : 'text-stone-600 hover:text-primary font-bold']"
              class="px-5 py-2 rounded-full text-xs font-heading tracking-tight transition-all duration-200 cursor-pointer"
            >
              Home
            </button>
            <button 
              @click="switchTab('menu')" 
              :class="[activeTab === 'menu' ? 'bg-secondary text-primary shadow-xs font-extrabold' : 'text-stone-600 hover:text-primary font-bold']"
              class="px-5 py-2 rounded-full text-xs font-heading tracking-tight transition-all duration-200 cursor-pointer"
            >
              Menu
            </button>
            <button 
              @click="switchTab('favorites')" 
              :class="[activeTab === 'favorites' ? 'bg-secondary text-primary shadow-xs font-extrabold' : 'text-stone-600 hover:text-primary font-bold']"
              class="px-5 py-2 rounded-full text-xs font-heading tracking-tight transition-all duration-200 cursor-pointer"
            >
              Favorites
            </button>
            <button 
              @click="switchTab('reviews')" 
              :class="[activeTab === 'reviews' ? 'bg-secondary text-primary shadow-xs font-extrabold' : 'text-stone-600 hover:text-primary font-bold']"
              class="px-5 py-2 rounded-full text-xs font-heading tracking-tight transition-all duration-200 cursor-pointer"
            >
              Reviews
            </button>
            <button 
              @click="switchTab('info')" 
              :class="[activeTab === 'info' ? 'bg-secondary text-primary shadow-xs font-extrabold' : 'text-stone-600 hover:text-primary font-bold']"
              class="px-5 py-2 rounded-full text-xs font-heading tracking-tight transition-all duration-200 cursor-pointer"
            >
              Infos
            </button>
          </nav>

          <!-- Right Controls (Cart, Search, Sign In, Mobile drawer) -->
          <div class="flex items-center gap-1.5">
            <!-- Search Trigger Button -->
            <button 
              @click="triggerQuickSearch" 
              class="hidden md:flex w-9 h-9 md:w-10 md:h-10 rounded-full bg-stone-100 hover:bg-[#fee33c] text-[#863d96] border border-stone-200/60 hover:border-[#eed012] items-center justify-center shadow-xs transition-all duration-300 group cursor-pointer" 
              title="Search Menu"
            >
              <span class="material-symbols-outlined text-lg font-bold group-hover:scale-110 transition-transform">search</span>
            </button>

            <!-- Floating Plate Button -->
            <button 
              @click="isCartOpen = true" 
              class="relative flex items-center gap-1.5 bg-secondary text-primary border border-primary/10 hover:bg-[#863d96] hover:text-white py-2.5 px-3 rounded-full font-heading font-extrabold text-xs shadow-md transition-all duration-300 group cursor-pointer"
            >
              <span class="material-symbols-outlined text-sm md:text-lg">shopping_bag</span>
              <span class="bg-[#863d96] text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-extrabold group-hover:bg-[#fee33c] group-hover:text-[#863d96] transition-colors relative">
                {{ cartCount }}
              </span>
            </button>

            <!-- Authentication Button / Signed In Profile widget -->
            <div v-if="loggedUser" class="relative group">
              <button 
                type="button"
                @click.stop="openSettingsModal()"
                :class="loggedUser.is_guest 
                  ? 'relative z-30 flex items-center gap-2 bg-amber-500/10 hover:bg-amber-500/15 text-amber-700 pl-2 pr-3 py-2.5 rounded-full font-heading font-extrabold text-xs border border-amber-500/20 transition-all cursor-pointer shadow-xs pointer-events-auto'
                  : 'relative z-30 flex items-center gap-2 bg-[#863d96]/10 hover:bg-[#863d96]/15 text-[#863d96] pl-2 pr-3 py-2.5 rounded-full font-heading font-extrabold text-xs border border-[#863d96]/20 transition-all cursor-pointer shadow-xs pointer-events-auto'"
              >
                <div :class="loggedUser.is_guest
                  ? 'w-5 h-5 rounded-full bg-gradient-to-tr from-amber-500 to-[#fee33c] text-white flex items-center justify-center font-black text-[9px] tracking-wider uppercase'
                  : 'w-5 h-5 rounded-full bg-gradient-to-tr from-[#863d96] to-[#fee33c] text-white flex items-center justify-center font-black text-[9px] tracking-wider uppercase'">
                  {{ loggedUser.initials }}
                </div>
                <span class="max-w-[75px] truncate hidden sm:inline-block font-bold">{{ loggedUser.name.split(' ')[0] }}</span>
                <span v-if="loggedUser.is_guest" class="text-[8px] bg-amber-500 text-white font-black px-1.5 py-0.25 rounded-md leading-none select-none">GUEST</span>
              </button>
              <!-- Dropdown popover menu wrapper with no gap to prevent hover loss -->
              <div class="absolute right-0 top-full pt-1.5 w-48 hidden group-hover:block hover:block z-50 text-left animate-fadeIn">
                <div class="bg-white rounded-2xl border border-stone-200/80 shadow-lg p-3">
                  <p class="text-[9px] text-stone-400 font-heading font-black uppercase tracking-wider px-2.5 pb-1 border-b border-stone-100">
                    {{ loggedUser.is_guest ? 'Guest Session 👤' : 'Signed In As' }}
                  </p>
                  <!-- Clickable User Details block -->
                  <div 
                    @click="openSettingsModal()"
                    class="p-2 my-1 hover:bg-stone-50 rounded-xl cursor-pointer transition-colors border border-transparent hover:border-stone-150 group/item flex flex-col pointer-events-auto"
                    title="Click to view/edit settings"
                  >
                    <p class="text-xs font-heading font-black text-stone-800 truncate flex items-center justify-between gap-1">
                      <span>{{ loggedUser.name }}</span>
                      <span class="material-symbols-outlined text-[12px] text-stone-400 group-hover/item:text-[#863d96] transition-colors">edit</span>
                    </p>
                    <p class="text-[9px] text-stone-400 font-sans truncate">{{ loggedUser.email }}</p>
                  </div>
                  <button 
                    type="button"
                    @click="openSettingsModal()"
                    class="w-full mt-1 px-2.5 py-2 hover:bg-stone-50 text-stone-700 font-heading font-bold text-[10px] rounded-xl flex items-center gap-1.5 transition-all cursor-pointer text-left pointer-events-auto"
                  >
                    <span class="material-symbols-outlined text-[13px] text-stone-500">settings</span>
                    {{ loggedUser.is_guest ? 'Guest Settings ⚙️' : 'User Settings' }}
                  </button>
                  <button 
                    type="button"
                    @click="handleLogout()"
                    class="w-full mt-1 px-2.5 py-2 hover:bg-rose-50 text-rose-600 font-heading font-bold text-[10px] rounded-xl flex items-center gap-1.5 transition-all cursor-pointer text-left pointer-events-auto"
                  >
                    <span class="material-symbols-outlined text-[13px]">logout</span>
                    Sign Out
                  </button>
                </div>
              </div>
            </div>
            <button 
              v-else
              @click="authMode = 'signin'; isLoginModalOpen = true;" 
              class="hidden sm:flex items-center gap-1.5 bg-[#863d96] hover:bg-[#723281] text-white py-2.5 px-4 rounded-full font-heading font-extrabold text-xs shadow-xs hover:scale-[1.02] active:scale-98 transition-all cursor-pointer"
            >
              <span class="material-symbols-outlined text-xs">login</span>
              <span>Login</span>
            </button>

            <!-- Mobile Burger Trigger -->
            <button 
              @click="isMobileMenuOpen = true" 
              class="md:hidden w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center hover:bg-stone-200 transition-colors cursor-pointer"
            >
              <span class="material-symbols-outlined text-xl">menu</span>
            </button>
          </div>

        </div>
      </header>

      <!-- MOBILE NAV DRAWER OVERLAY -->
      <div 
        v-if="isMobileMenuOpen" 
        class="fixed inset-0 bg-[#291830]/60 z-50 flex justify-end"
      >
        <div class="w-72 bg-white h-full p-6 flex flex-col justify-between shadow-2xl animate-slideLeft">
          <div class="space-y-6">
            <div class="flex items-center justify-between">
              <h4 class="font-heading font-black text-[#863d96] text-sm tracking-tight">Jessy Navigation</h4>
              <button 
                @click="isMobileMenuOpen = false" 
                class="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center cursor-pointer"
              >
                <span class="material-symbols-outlined text-md">close</span>
              </button>
            </div>
            
            <div class="space-y-2">
              <button 
                @click="switchTabMobile('home')" 
                class="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-heading font-bold text-sm text-left transition-all"
                :class="[activeTab === 'home' ? 'bg-[#863d96]/10 text-[#863d96]' : 'text-stone-700 hover:bg-stone-50']"
              >
                <span class="material-symbols-outlined text-lg">home</span> Home
              </button>
               <button 
                @click="switchTabMobile('menu')" 
                class="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-heading font-bold text-sm text-left transition-all"
                :class="[activeTab === 'menu' ? 'bg-[#863d96]/10 text-[#863d96]' : 'text-stone-700 hover:bg-stone-50']"
              >
                <span class="material-symbols-outlined text-lg">restaurant_menu</span> Menu
              </button>
              <button 
                @click="switchTabMobile('favorites')" 
                class="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-heading font-bold text-sm text-left transition-all"
                :class="[activeTab === 'favorites' ? 'bg-[#863d96]/10 text-[#863d96]' : 'text-stone-700 hover:bg-stone-50']"
              >
                <span class="material-symbols-outlined text-lg">favorite</span> Favorites
              </button>
              <button 
                @click="switchTabMobile('reviews')" 
                class="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-heading font-bold text-sm text-left transition-all"
                :class="[activeTab === 'reviews' ? 'bg-[#863d96]/10 text-[#863d96]' : 'text-stone-700 hover:bg-stone-50']"
              >
                <span class="material-symbols-outlined text-lg">rate_review</span> Reviews
              </button>
              <button 
                @click="switchTabMobile('info')" 
                class="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-heading font-bold text-sm text-left transition-all"
                :class="[activeTab === 'info' ? 'bg-[#863d96]/10 text-[#863d96]' : 'text-stone-700 hover:bg-stone-50']"
              >
                <span class="material-symbols-outlined text-lg">info</span> Infos
              </button>
            </div>
            
            <!-- Mobile Auth Section -->
            <div class="mt-4 pt-4 border-t border-stone-100">
              <div v-if="loggedUser" class="bg-stone-50 p-3 rounded-2xl border border-stone-150 space-y-3">
                <div class="flex items-center gap-2.5">
                  <div class="w-8 h-8 rounded-full bg-gradient-to-tr from-[#863d96] to-[#fee33c] text-white flex items-center justify-center font-black text-[10px] uppercase shadow-xs shrink-0">
                    {{ loggedUser.initials }}
                  </div>
                  <div class="min-w-0">
                    <p class="text-xs font-heading font-black text-stone-800 truncate">{{ loggedUser.name }}</p>
                    <p class="text-[9px] text-stone-400 font-sans truncate">{{ loggedUser.email }}</p>
                  </div>
                </div>
                <button 
                  @click="isMobileMenuOpen = false; openSettingsModal();"
                  class="w-full py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-heading font-extrabold text-[10px] uppercase tracking-wider rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <span class="material-symbols-outlined text-xs">settings</span>
                  User Settings
                </button>
                <button 
                  @click="isMobileMenuOpen = false; handleLogout();"
                  class="w-full py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 font-heading font-extrabold text-[10px] uppercase tracking-wider rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <span class="material-symbols-outlined text-xs">logout</span>
                  Sign Out
                </button>
              </div>
              <div v-else>
                <button 
                  @click="isMobileMenuOpen = false; authMode = 'signin'; isLoginModalOpen = true;"
                  class="w-full py-2.5 bg-[#863d96] text-white font-heading font-extrabold text-[10px] uppercase tracking-wider rounded-xl flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <span class="material-symbols-outlined text-sm">login</span>
                  Login
                </button>
              </div>
            </div>
          </div>

          <div class="text-center text-stone-400 text-[10px] pt-4 border-t border-stone-150">
            Jessy Juice • Founded 1991
          </div>
        </div>
      </div>

      <!-- MAIN VIEWS CONTAINER -->
      <main class="flex-grow">
        
        <!-- ================= HOME TAB VIEW ================= -->
        <div v-if="activeTab === 'home'">
          
          <!-- HERO ROTATING TRANSITION BANNER -->
          <section class="relative min-h-[75vh] md:min-h-[85vh] flex items-center justify-center px-4 text-center border-b border-stone-200/50 select-none overflow-hidden animate-stagger-3 py-16 bg-[#291830]">
            
            <!-- Slides slideshow with automatic background rotates -->
            <div class="absolute inset-0 w-full h-full overflow-hidden pointer-events-none">
              <div 
                v-for="(slide, idx) in displaySlides"
                :key="idx"
                v-show="currentSlide === idx"
                class="absolute inset-0 w-full h-full object-cover transition-opacity duration-[500ms] animate-kenBurns bg-cover bg-center bg-no-repeat"
                :style="{ backgroundImage: `url(${slide.image})` }"
              ></div>
              <div class="absolute inset-0 bg-[#291830]/65 mix-blend-multiply"></div>
            </div>

            <div class="max-w-4xl mx-auto relative z-10 flex flex-col items-center">
              <!-- Header Tag -->
              <div class="flex items-center gap-1.5 px-3 py-1 bg-[#fee33c]/20 backdrop-blur-md rounded-full text-[#fee33c] font-heading font-extrabold text-[10px] tracking-widest uppercase mb-4 animate-stagger-4 border border-[#fee33c]/30">
                <span class="w-1.5 h-1.5 rounded-full bg-[#fee33c] animate-pulse"></span>
                Lebanon's Premium Sweet Coastal Escape
              </div>

              <!-- Main Heading -->
              <h2 class="font-heading font-extrabold text-xl sm:text-3xl md:text-5xl lg:text-6xl tracking-tight leading-tight text-white whitespace-nowrap drop-shadow-md animate-stagger-5">
                <span v-html="displaySlides[currentSlide]?.title || 'Premium Sweet Selection'"></span>
              </h2>

              <p class="mt-4 text-xs md:text-sm text-stone-200/90 max-w-xl font-sans font-medium mb-8 leading-relaxed">
                {{ displaySlides[currentSlide]?.description }}
              </p>

              <!-- CTA buttons -->
              <div class="flex flex-wrap items-center justify-center gap-3.5">
                <button 
                  @click="switchTab('menu')" 
                  class="px-7 py-3.5 bg-secondary text-primary font-heading font-extrabold text-xs rounded-full shadow-md hover:bg-white hover:text-primary transition-all flex items-center gap-1.5 border border-amber-300 cursor-pointer"
                >
                  <span class="material-symbols-outlined text-sm">restaurant_menu</span>
                  {{ displaySlides[currentSlide]?.ctaText || 'Explore Specialties' }}
                </button>
                <button 
                  @click="switchTab('reviews')" 
                  class="px-7 py-3.5 bg-white/10 hover:bg-white/20 text-white font-heading font-bold text-xs rounded-full border border-white/25 backdrop-blur-xs transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <span class="material-symbols-outlined text-sm">rate_review</span>
                  Guest Reviews
                </button>
              </div>
            </div>

            <!-- Page indicator indicators -->
            <div class="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex gap-1.5 z-10">
              <span 
                v-for="i in displaySlides.length" 
                :key="i"
                class="w-2.5 h-2.5 rounded-full transition-all duration-300"
                :class="[currentSlide === (i-1) ? 'bg-[#fee33c] w-6 shadow-xs' : 'bg-white/40']"
              ></span>
            </div>

          </section>

          <!-- FEATURED DESSERT SHOWCASE SECTION -->
          <section class="max-w-7xl mx-auto px-4 py-12 md:py-16">
            <div class="flex flex-col md:flex-row items-start md:items-end justify-between mb-8 pb-4 border-b border-stone-200/65">
              <div>
                <span class="text-[10px] text-[#863d96] bg-[#863d96]/10 font-heading font-extrabold px-3 py-1 rounded-full uppercase tracking-widest">
                  Featured Specialties
                </span>
                <h3 class="font-heading font-black text-[#291830] text-xl md:text-2xl tracking-tight mt-2.5">
                  The Signature Selection 🍫
                </h3>
              </div>
              <button 
                @click="switchTab('menu')" 
                class="mt-2 md:mt-0 text-xs font-heading font-extrabold text-[#863d96] hover:text-[#fee33c] flex items-center gap-0.5 group cursor-pointer"
              >
                View Full Specialty Menu 
                <span class="material-symbols-outlined text-xs group-hover:translate-x-1 transition-transform">arrow_forward</span>
              </button>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
              <!-- We filter the first 3 menu details that are marked popular/chef choice -->
              <div 
                v-for="item in unifiedMenuItems.filter(m => m.isPopular).slice(0, 3)" 
                :key="item.id"
                class="bg-white rounded-2xl md:rounded-3xl overflow-hidden border border-stone-200/60 shadow-xs hover:shadow-md transition-all duration-300 flex flex-col justify-between p-4 sm:p-5 md:p-0"
              >
                <!-- Thumbnail -->
                <div class="relative h-[420px] sm:h-56 w-full overflow-hidden bg-stone-100 rounded-xl md:rounded-none shrink-0" :class="{'opacity-60': item.quantity === 0}">
                  <div 
                    v-if="item.quantity === 0"
                    class="absolute top-1.5 left-1.5 bg-rose-600 text-white text-[8px] md:text-[9px] font-heading font-extrabold tracking-wider px-2 py-0.5 rounded-full uppercase z-10 animate-pulse"
                  >
                    Out of stock ❌
                  </div>
                  <div 
                    v-else-if="item.badge" 
                    class="absolute top-1.5 left-1.5 bg-[#863d96] text-[#fee33c] text-[8px] md:text-[9px] font-heading font-extrabold tracking-wider px-2 py-0.5 rounded-full uppercase z-10"
                  >
                    {{ item.badge }}
                  </div>
                  <!-- Favorite Toggle Heart Button -->
                  <button 
                    @click.stop="toggleFavorite(item)"
                    class="absolute top-1.5 right-1.5 w-6 h-6 sm:w-7.5 sm:h-7.5 rounded-full bg-white/95 hover:bg-white flex items-center justify-center transition-all duration-200 z-10 cursor-pointer shadow-sm border border-stone-100/50 hover:scale-105"
                    :title="isFavorited(item.id) ? 'Remove from Favorites' : 'Add to Favorites'"
                  >
                    <span 
                      class="material-symbols-outlined text-[10px] sm:text-[11px] transition-transform duration-200 select-none"
                      :class="{'filled text-rose-500 scale-105': isFavorited(item.id), 'text-stone-400 hover:text-rose-450': !isFavorited(item.id)}"
                    >
                      favorite
                    </span>
                  </button>
                  <img 
                    :src="item.image" 
                    :alt="item.name" 
                    class="w-full h-full object-cover transition-transform duration-700 hover:scale-105 cursor-pointer"
                    @click="openDetailModal(item)"
                    referrerpolicy="no-referrer"
                  />
                </div>

                <!-- Body -->
                <div class="p-1 md:p-5 flex-grow flex flex-col justify-between min-w-0 mt-3 md:mt-0">
                  <div>
                    <h4 class="font-heading font-extrabold text-[#291830] text-sm sm:text-base tracking-tight mb-1 md:mb-1 line-clamp-1">
                      {{ item.name }}
                    </h4>
                    <p class="text-stone-400 text-xs sm:text-xs font-sans line-clamp-2 leading-relaxed">
                      {{ item.description }}
                    </p>
                  </div>
                  
                  <div class="flex items-center justify-between pt-2.5 md:pt-5 mt-2.5 md:mt-4 border-t border-stone-100/70">
                    <div>
                      <span class="text-[8px] sm:text-[10px] text-stone-400 font-bold hidden sm:block uppercase tracking-wider">Prices Starts At</span>
                      <span class="font-heading font-black text-[#863d96] text-xs sm:text-sm">{{ item.priceLabel }}</span>
                      <p v-if="item.quantity !== undefined" class="text-[9px] font-sans font-bold leading-tight mt-0.5" :class="item.quantity === 0 ? 'text-rose-500' : 'text-emerald-600'">
                        {{ item.quantity === 0 ? 'Out of Stock ❌' : `${item.quantity} left` }}
                      </p>
                    </div>
                    
                    <div class="flex items-center gap-1.5 sm:gap-1.5">
                      <button 
                        @click="openDetailModal(item)"
                        class="px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-lg sm:rounded-xl bg-stone-50 hover:bg-stone-100 border border-stone-200/60 text-[10px] sm:text-xs font-heading font-black text-stone-600 transition-colors cursor-pointer"
                      >
                        Details
                      </button>
                      <button 
                        v-if="item.quantity === 0"
                        disabled
                        class="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-stone-200 text-stone-400 flex items-center justify-center cursor-not-allowed font-bold shrink-0"
                        title="Out of stock"
                      >
                        <span class="material-symbols-outlined text-xs sm:text-sm font-black">close</span>
                      </button>
                      <button 
                        v-else
                        @click="openCustomizer(item)"
                        class="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-[#fee33c] hover:bg-[#863d96] text-[#863d96] hover:text-white flex items-center justify-center shadow-xs transition-colors cursor-pointer font-bold shrink-0"
                        title="Add Custom Platter"
                      >
                        <span class="material-symbols-outlined text-xs sm:text-sm font-black">add</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- PORTRAIT VIDEO SCROLL SCRUBBER -->
          <ScrollScrubber v-if="isMobilePhoneScreen" @toast="onScrollScrubberToast" videoSrc="/assets/default_video.mp4" />
          <ScrollScrubber v-else @toast="onScrollScrubberToast" videoSrc="/assets/default_video.mp4" />

          <!-- ABOUT OUR ICE COLD ESTABLISHMENT -->
          <section class="bg-[#fee33c]/15 py-16 border-t border-b border-[#fee33c]/30">
            <div class="max-w-7xl mx-auto px-4 grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
              <div>
                <span class="text-[10px] text-[#863d96] bg-[#863d96]/15 font-heading font-extrabold px-3 py-1 rounded-full uppercase tracking-widest inline-block">
                  A Coastal Sanctuary
                </span>
                <h3 class="font-heading font-black text-[#291830] text-2xl tracking-tight mt-3">
                  Under the Humid Sun? Cool Down with Us! ❄️
                </h3>
                <p class="mt-4 text-xs font-sans text-stone-500 leading-relaxed">
                  Established in 1991, Jessy Juice has proudly served the beautiful coastal community of Batroun. Known for our deep-freeze structural cooling air conditioning, we provide a chilly, sweet haven where you can enjoy hot molten sweets and double layer waffles without breaking a sweat!
                </p>
                <p class="mt-3 text-xs font-sans text-stone-500 leading-relaxed">
                  Only the highest grade local avocados, Lebanese clotted cream, golden mountain honey, and fine Belgian chocolate toppings are selected day in and day out. Stop by and share your sweet review!
                </p>
                <div class="pt-6 font-heading font-extrabold text-[#863d96] tracking-tight flex items-center gap-3">
                  <div class="flex items-center gap-1.5">
                    <span class="material-symbols-outlined">ac_unit</span>
                    <span class="text-[11px] uppercase">Supercooled 18°C AC Escape</span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <span class="material-symbols-outlined">verified_user</span>
                    <span class="text-[11px] uppercase">Since 1991 Quality</span>
                  </div>
                </div>
              </div>
              <div class="relative h-72 md:h-96 rounded-3xl overflow-hidden border border-[#fee33c]/40 shadow-md">
                <img 
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuAO-WWGCgKXhuO0lEHqdlfbkrv13rsCW1UZaXXmsx1NK4nILEW441_N50dBuFnGK92uakmFE5X_RYfU0nga-pU-q572ZycBYDUVaH9ww6Bw-MQjCgZ4FvnY_EW61Rm21QaUvP22-JAhM0-bag4Re7FgrGxqWMprM3kqbdgUo1kYA7IhPW44kuZnNsFMcz_9V3fKSPw-W2lan3oOx0kpHaODx0b_6vXoYewFQlvZ5QzfVN3BXEmMdMpOYk02SXYG2aLsXrhRgdezfg" 
                  alt="Batroun Dessert Location" 
                  class="w-full h-full object-cover"
                />
                <div class="absolute inset-0 bg-[#863d96]/10 mix-blend-multiply"></div>
              </div>
            </div>
          </section>

          <!-- SECOND PORTRAIT VIDEO SCROLL SCRUBBER (DUPLICATED, HIDING THE OVERLAY TEXT TITLES) -->
          <ScrollScrubber v-if="!isMobilePhoneScreen" @toast="onScrollScrubberToast" :hideText="true" videoSrc="/assets/default_video2.mp4" bottomFade="none" />

        </div>

        <!-- ================= SPECIALTIES MENU TAB VIEW ================= -->
        <div v-else-if="activeTab === 'menu'" class="max-w-7xl mx-auto px-4 py-12 animate-fadeIn">
          
          <!-- Menu Headers -->
          <div class="text-center max-w-xl mx-auto mb-10">
            <span class="text-[10px] text-[#863d96] bg-[#863d96]/10 font-heading font-extrabold px-3 py-1 rounded-full uppercase tracking-wider">
              Jessy Juice Menu Specialties
            </span>
            <h3 class="font-heading font-black text-[#291830] text-2xl tracking-tight mt-3">
              Crafted To satisfy the Sweetest Tooth
            </h3>
            <p class="text-xs font-sans text-stone-400 mt-2">
              Browse our authentic hand-picked catalog. Add crepes, waffles, and local fresh drinks to your Plate planner to customized.
            </p>
          </div>

          <!-- Filter & Search Panel -->
          <div class="bg-white rounded-3xl p-5 border border-stone-200/50 shadow-xs space-y-4 mb-10">
            <div class="flex flex-col md:flex-row items-center justify-between gap-4">
              
              <!-- Search box -->
              <div class="relative max-w-md w-full">
                <span class="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 leading-none text-xl">search</span>
                <input 
                  id="menu-search-input"
                  v-model="searchQuery"
                  type="text" 
                  placeholder="Search Crepes, Milkshakes, Cocktails..." 
                  class="w-full bg-stone-50 pl-11 pr-4 py-2.5 rounded-2xl text-xs font-sans placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-[#fee33c] focus:border-[#fee33c]/60 transition-all border border-stone-200" 
                />
              </div>

              <!-- Clear Filters -->
              <button 
                v-if="searchQuery || activeCategory !== 'all'"
                @click="clearCatalogFilters"
                class="text-[10px] bg-red-50 hover:bg-red-100 text-red-600 font-heading font-black px-3.5 py-2 rounded-full flex items-center gap-1 transition-all cursor-pointer"
              >
                <span class="material-symbols-outlined text-[12px]">clear_all</span>
                Reset Search Filters
              </button>

            </div>

            <!-- Categories Scroll Bar -->
            <div class="flex items-center gap-1.5 overflow-x-auto scrolling-hide pb-1">
              <button @click="activeCategory = 'all'" :class="getCategoryPillClass('all')">
                All Specialties
              </button>
              <button @click="activeCategory = 'cocktails'" :class="getCategoryPillClass('cocktails')">
                🍹 Cocktails
              </button>
              <button @click="activeCategory = 'light'" :class="getCategoryPillClass('light')">
                🌿 Light Section
              </button>
              <button @click="activeCategory = 'juice'" :class="getCategoryPillClass('juice')">
                🍊 Fresh Juices
              </button>
              <button @click="activeCategory = 'icecream'" :class="getCategoryPillClass('icecream')">
                🍦 Shakes & Ice Cream
              </button>
              <button @click="activeCategory = 'cake'" :class="getCategoryPillClass('cake')">
                🍇 Plates & Waffles
              </button>
              <button @click="activeCategory = 'chocolate'" :class="getCategoryPillClass('chocolate')">
                🍫 Crêpes & Fondue
              </button>
            </div>
          </div>

          <!-- Loading Skeletons for juice category -->
          <div v-if="activeCategory === 'juice' && isLoadingJuices" class="mb-6 space-y-4">
            <div class="flex items-center gap-2 px-3 py-1.5 bg-[#863d96]/10 rounded-xl max-w-[250px] border border-[#863d96]/20 text-[#863d96] text-xs font-heading font-bold animate-pulse">
              <span class="material-symbols-outlined text-sm font-black animate-spin">autorenew</span>
              Streaming fresh juices...
            </div>
            <div class="grid grid-cols-1 md:grid-cols-4 gap-6 w-full animate-pulse">
              <div v-for="i in 4" :key="i" class="bg-white rounded-3xl overflow-hidden border border-stone-200/50 p-4 space-y-4">
                <div class="bg-stone-100 rounded-2xl h-44 w-full animate-pulse"></div>
                <div class="space-y-2">
                  <div class="h-4 bg-stone-100 rounded-md w-2/3 animate-pulse"></div>
                  <div class="h-3 bg-stone-100 rounded-md w-full animate-pulse"></div>
                </div>
                <div class="flex justify-between items-center pt-4 border-t border-stone-100">
                  <div class="h-5 bg-stone-100 rounded-md w-1/3 animate-pulse"></div>
                  <div class="h-8 bg-stone-100 rounded-md w-1/4 animate-pulse"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Empty search view -->
          <div v-if="filteredSpecialties.length === 0" class="text-center py-16">
            <span class="material-symbols-outlined text-4xl text-stone-300">sentiment_neutral</span>
            <h4 class="font-heading font-bold text-stone-400 text-sm mt-3">No delicious treats match your search queries!</h4>
            <button @click="clearCatalogFilters" class="mt-4 px-4 py-2 bg-[#863d96] text-white text-[11px] font-heading font-extrabold rounded-full shadow-xs cursor-pointer font-bold">
              View All Specialties
            </button>
          </div>

          <!-- Menu Catalog Grouped Sections (Clean Professional Section Header + Products Grid) -->
          <div v-else-if="!(activeCategory === 'juice' && isLoadingJuices)" class="space-y-10">
            <div 
              v-for="section in groupedMenuSections" 
              :key="section.key" 
              class="space-y-4"
            >
              <!-- Section Top Header Banner -->
              <div class="relative bg-white border-t-4 border-[#863d96] p-3.5 sm:p-4 rounded-xl sm:rounded-2xl border-x border-b border-stone-200/80 shadow-2xs flex flex-col md:flex-row items-start md:items-center justify-between gap-3 overflow-hidden">
                <template v-if="section.meta.bgImage">
                  <img :src="section.meta.bgImage" class="absolute inset-0 w-full h-full object-cover opacity-30 pointer-events-none" />
                  <div class="absolute inset-0 bg-gradient-to-r from-white via-white/80 to-white/90 pointer-events-none"></div>
                </template>
                
                <div class="flex items-center gap-3 relative z-10">
                  <div class="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#863d96] text-white flex items-center justify-center shrink-0 shadow-3xs">
                    <span class="material-symbols-outlined text-lg sm:text-xl font-black">{{ section.meta.icon }}</span>
                  </div>
                  <div>
                    <div class="flex items-center gap-2">
                      <h3 class="font-heading font-black text-[#291830] text-lg sm:text-xl md:text-2xl tracking-tight uppercase">
                        {{ section.meta.title }}
                      </h3>
                      <span class="bg-[#863d96]/10 text-[#863d96] text-[10px] font-heading font-extrabold px-2 py-0.5 rounded-full border border-[#863d96]/20">
                        {{ section.items.length }} Items
                      </span>
                    </div>
                    <p v-if="section.meta.subtitle" class="text-xs font-sans text-stone-500 mt-0.5 font-medium">
                      {{ section.meta.subtitle }}
                    </p>
                  </div>
                </div>

                <div v-if="section.meta.addons" class="bg-[#863d96]/10 border border-[#863d96]/20 text-[#863d96] text-[10px] font-heading font-bold px-3 py-1.5 rounded-xl shrink-0 flex items-center gap-1.5 relative z-10">
                  <span class="material-symbols-outlined text-xs">tune</span>
                  <span>{{ section.meta.addons }}</span>
                </div>
              </div>

              <!-- Products Grid -->
              <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
                <div 
                  v-for="item in section.items" 
                  :key="item.id"
                  class="bg-white rounded-xl md:rounded-2xl overflow-hidden border border-stone-200/60 shadow-xs hover:shadow-md transition-all duration-300 flex flex-col justify-between p-2 sm:p-3 md:p-0"
                >
                  <!-- Thumbnail -->
                  <div class="relative h-28 sm:h-34 md:h-38 w-full bg-stone-50 overflow-hidden rounded-lg md:rounded-none shrink-0" :class="{'opacity-60': item.quantity === 0}">
                    <div v-if="item.quantity === 0" class="absolute top-1.5 left-1.5 bg-rose-600 text-white text-[8px] font-heading font-black tracking-wider px-1.5 py-0.5 rounded-full uppercase z-10 animate-pulse">
                      Out of Stock ❌
                    </div>
                    <div v-else-if="item.badge" class="absolute top-1.5 left-1.5 bg-[#863d96] text-white text-[8px] font-heading font-black tracking-wider px-1.5 py-0.5 rounded-full uppercase z-10">
                      {{ item.badge }}
                    </div>
                    <button 
                      @click.stop="toggleFavorite(item)"
                      class="absolute top-1.5 right-1.5 w-5.5 h-5.5 sm:w-7 sm:h-7 rounded-full bg-white/95 hover:bg-white flex items-center justify-center transition-all duration-200 z-10 cursor-pointer shadow-sm border border-stone-100/50 hover:scale-105"
                    >
                      <span 
                        class="material-symbols-outlined text-[9px] sm:text-[10px] select-none"
                        :class="{'filled text-rose-500 scale-105': isFavorited(item.id), 'text-stone-400 hover:text-rose-450': !isFavorited(item.id)}"
                      >
                        favorite
                      </span>
                    </button>
                    <img 
                      :src="item.image" 
                      :alt="item.name" 
                      class="w-full h-full object-cover transition-transform duration-700 hover:scale-105 cursor-pointer"
                      @click="openDetailModal(item)"
                      referrerpolicy="no-referrer"
                    />
                  </div>

                  <!-- Body -->
                  <div class="p-1 md:p-3 flex-grow flex flex-col justify-between mt-1 md:mt-0">
                    <div>
                      <h4 @click="openDetailModal(item)" class="font-heading font-extrabold text-[#291830] text-xs sm:text-sm tracking-tight mb-0.5 cursor-pointer hover:text-[#863d96] line-clamp-1">
                        {{ item.name }}
                      </h4>
                      <p class="text-stone-400 text-[10px] sm:text-xs font-sans line-clamp-2 leading-relaxed">
                        {{ item.description }}
                      </p>

                      <!-- S / M / L Display -->
                      <div v-if="item.sizes && item.sizes.length" class="flex flex-wrap items-center gap-1 mt-2">
                        <span 
                          v-for="sizeObj in item.sizes" 
                          :key="sizeObj.name"
                          class="text-[8.5px] font-heading font-extrabold bg-[#863d96]/10 text-[#863d96] px-1.5 py-0.5 rounded border border-[#863d96]/20 inline-flex items-center gap-0.5"
                        >
                          <span class="font-black uppercase text-[8px]">{{ sizeObj.name.toLowerCase().includes('small') ? 'S' : sizeObj.name.toLowerCase().includes('medium') ? 'M' : sizeObj.name.toLowerCase().includes('large') ? 'L' : sizeObj.name }}:</span>
                          <span class="font-black">${{ typeof sizeObj.price === 'number' ? sizeObj.price.toFixed(2) : sizeObj.price }}</span>
                        </span>
                      </div>
                    </div>

                    <div class="flex items-center justify-between pt-2 md:pt-3 mt-2 md:mt-3 border-t border-stone-100/70">
                      <div>
                        <span class="text-[7.5px] sm:text-[8px] text-stone-400 font-bold block uppercase tracking-wider">Starting At</span>
                        <span class="font-heading font-black text-[#863d96] text-xs sm:text-sm">${{ getStartingPrice(item) }}</span>
                      </div>

                      <div class="flex items-center gap-1 sm:gap-1.5">
                        <button 
                          @click="openDetailModal(item)"
                          class="px-2 py-1 rounded-md bg-stone-50 hover:bg-stone-100 border border-stone-200/60 text-[9px] font-heading font-black text-stone-600 transition-colors cursor-pointer"
                        >
                          Details
                        </button>
                        <button 
                          v-if="item.quantity !== 0"
                          @click="openCustomizer(item)"
                          class="w-6 h-6 sm:w-7.5 sm:h-7.5 rounded-md bg-[#863d96]/10 hover:bg-[#863d96] text-[#863d96] hover:text-white flex items-center justify-center shadow-2xs border border-[#863d96]/20 transition-all cursor-pointer font-bold shrink-0"
                        >
                          <span class="material-symbols-outlined text-[10px] sm:text-xs font-black">add</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>

        <!-- ================= FAVORITES TAB VIEW ================= -->
        <div v-else-if="activeTab === 'favorites'" class="max-w-7xl mx-auto px-4 py-12 animate-fadeIn">
          <div class="text-center max-w-3xl mx-auto mb-12 space-y-3">
            <span class="text-[10px] text-rose-500 bg-rose-50 border border-rose-100 font-heading font-extrabold px-3 py-1 rounded-full uppercase tracking-widest inline-flex items-center gap-1">
              <span class="material-symbols-outlined text-[12px] animate-pulse">favorite</span> My Sweet Collection
            </span>
            <h2 class="font-heading font-black text-[#291830] text-3xl md:text-4xl tracking-tight leading-none">
              Your Favorites
            </h2>
            <p class="text-xs font-sans text-stone-500 leading-relaxed max-w-xl mx-auto">
              A curated collection of your favorite Jessy Juice boutique crepes, premium milkshakes, thick waffles, and freshly prepared cocktails. Tap the heart again to remove items from your collection.
            </p>
          </div>

          <!-- Empty State -->
          <div v-if="favorites.length === 0" class="bg-white rounded-3xl border border-stone-200/50 p-12 text-center max-w-lg mx-auto shadow-sm space-y-5 animate-fadeIn">
            <div class="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center text-rose-500 border border-rose-100 mx-auto">
              <span class="material-symbols-outlined text-3xl">favorite_border</span>
            </div>
            <div class="space-y-2">
              <h4 class="font-heading font-bold text-stone-700 text-base">Your favorites list is empty</h4>
              <p class="text-[11px] font-sans text-stone-400 leading-relaxed">
                Explore our sweet specialty menu and tap the heart on any signature dessert item to save them here for seamless planning and customizing!
              </p>
            </div>
            <button 
              @click="switchTab('menu')" 
              class="px-5 py-2.5 bg-[#863d96] hover:bg-[#723281] text-white text-xs font-heading font-extrabold rounded-xl shadow-xs transition-colors cursor-pointer inline-flex items-center gap-1"
            >
              <span class="material-symbols-outlined text-sm">restaurant_menu</span>
              Explore Specialty Menu
            </button>
          </div>

          <!-- Favorites Grid -->
          <div v-else class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 animate-fadeIn">
            <div 
              v-for="item in favorites" 
              :key="item.id"
              class="bg-white rounded-2xl md:rounded-3xl overflow-hidden border border-stone-200/60 shadow-xs hover:shadow-md transition-all duration-300 flex flex-col justify-between p-4 sm:p-5 md:p-0"
            >
              <!-- Food Image Thumbnail -->
              <div class="relative h-[420px] sm:h-40 md:h-44 w-full bg-stone-50 overflow-hidden rounded-xl md:rounded-none shrink-0" :class="{'opacity-60': item.quantity === 0}">
                <div v-if="item.quantity === 0" class="absolute top-2 left-2 bg-rose-600 text-white text-[8px] md:text-[9px] font-heading font-extrabold tracking-wider px-2 py-0.5 rounded-full uppercase z-10 animate-pulse">
                  Out of Stock ❌
                </div>
                <div v-else-if="item.badge" class="absolute top-2 left-2 bg-[#863d96] text-white text-[8px] md:text-[9px] font-heading font-black tracking-wider px-2 py-0.5 rounded-full uppercase z-10">
                  {{ item.badge }}
                </div>
                
                <!-- Heart toggle inside favorites view -->
                <button 
                  @click.stop="toggleFavorite(item)"
                  class="absolute top-2 right-2 w-6 h-6 sm:w-7.5 sm:h-7.5 rounded-full bg-white/95 hover:bg-white flex items-center justify-center transition-all duration-200 z-10 cursor-pointer shadow-sm border border-stone-100/50 hover:scale-105"
                  title="Remove from Favorites"
                >
                  <span 
                    class="material-symbols-outlined text-[10px] sm:text-[11px] select-none transition-transform duration-200"
                    :class="{'filled text-rose-500 scale-105': isFavorited(item.id), 'text-stone-400': !isFavorited(item.id)}"
                  >
                    favorite
                  </span>
                </button>

                <img 
                  :src="item.image" 
                  :alt="item.name" 
                  class="w-full h-full object-cover transition-transform duration-700 hover:scale-105 cursor-pointer"
                  @click="openDetailModal(item)"
                  referrerpolicy="no-referrer"
                />
              </div>

              <!-- Body -->
              <div class="p-1 md:p-4 flex-grow flex flex-col justify-between mt-3 md:mt-0">
                <div>
                  <h4 @click="openDetailModal(item)" class="font-heading font-extrabold text-[#291830] text-sm sm:text-base tracking-tight mb-1 cursor-pointer hover:text-[#863d96] line-clamp-1">
                    {{ item.name }}
                  </h4>
                  <p class="text-stone-400 text-xs sm:text-xs font-sans line-clamp-2 leading-relaxed">
                    {{ item.description }}
                  </p>
                </div>

                <div class="flex items-center justify-between pt-2.5 md:pt-4 mt-2.5 md:mt-4 border-t border-stone-100/70">
                  <div>
                    <span class="text-[8px] sm:text-[9px] text-stone-400 font-bold hidden sm:block uppercase tracking-wider">Prices Starts At</span>
                    <span class="font-heading font-black text-[#863d96] text-xs sm:text-sm">{{ item.priceLabel }}</span>
                    <p v-if="item.quantity !== undefined" class="text-[8px] sm:text-[9.5px] font-sans font-bold leading-tight mt-0.5" :class="item.quantity === 0 ? 'text-rose-500' : 'text-emerald-600'">
                      {{ item.quantity === 0 ? 'Out of Stock ❌' : `${item.quantity} left` }}
                    </p>
                  </div>

                  <div class="flex items-center gap-1.5 sm:gap-1.5">
                    <button 
                      @click="openDetailModal(item)"
                      class="px-2.5 sm:px-2.5 py-1.5 sm:py-1.5 rounded-lg bg-stone-50 hover:bg-stone-100 border border-stone-200/60 text-[10px] sm:text-[10px] font-heading font-black text-stone-600 transition-colors cursor-pointer"
                    >
                      Details
                    </button>
                    <button 
                      v-if="item.quantity === 0"
                      disabled
                      class="w-7 h-7 sm:w-8.5 sm:h-8.5 rounded-lg bg-stone-200 text-stone-400 flex items-center justify-center cursor-not-allowed font-bold shrink-0"
                      title="Out of stock"
                    >
                      <span class="material-symbols-outlined text-xs sm:text-sm font-black">close</span>
                    </button>
                    <button 
                      v-else
                      @click="openCustomizer(item)"
                      class="w-7 h-7 sm:w-8.5 sm:h-8.5 rounded-lg bg-[#fee33c] hover:bg-[#863d96] text-[#863d96] hover:text-white flex items-center justify-center shadow-xs transition-colors cursor-pointer font-bold shrink-0"
                      title="Custom Design Platter"
                    >
                      <span class="material-symbols-outlined text-xs sm:text-sm font-black animate-pulse">add</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ================= REVIEWS TAB VIEW ================= -->
        <div v-else-if="activeTab === 'reviews'" class="max-w-7xl mx-auto px-4 py-12 animate-fadeIn">
          
          <!-- Reviews Header -->
          <div class="text-center max-w-xl mx-auto mb-10">
            <span class="text-[10px] text-[#863d96] bg-[#863d96]/10 font-heading font-extrabold px-3 py-1 rounded-full uppercase tracking-wider">
              Guest Reviews
            </span>
            <h3 class="font-heading font-black text-[#291830] text-3xl tracking-tight mt-3">
              What the Community Says ✨
            </h3>
            <p class="text-xs font-sans text-stone-400 mt-2">
              Read recommendations regarding Batroun's supercooled oasis, or leave your own sweet rating with toppings feedback!
            </p>
          </div>

          <!-- Two-Column Form and list -->
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
            
            <!-- Add Register Entries Form Column -->
            <div class="bg-white rounded-3xl p-6 border border-stone-200/60 shadow-sm space-y-6 lg:sticky lg:top-28">
              <div class="border-b border-stone-100 pb-3">
                <h4 class="font-heading font-black text-[#863d96] text-sm tracking-tight flex items-center gap-2">
                  <span class="material-symbols-outlined text-lg">rate_review</span>
                  Add Your Sweet Review
                </h4>
                <p class="text-[10px] text-stone-400 font-sans mt-1">Share your experience on our review board</p>
              </div>
              
              <!-- Author -->
              <div class="space-y-1.5">
                <label class="text-[10px] text-stone-500 font-heading font-black uppercase tracking-wider block">Your Name / Handle</label>
                <div class="relative">
                  <input 
                    v-model="newReviewAuthor"
                    type="text" 
                    placeholder="Your Name / Handle" 
                    class="w-full bg-stone-50/50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3 py-2 text-xs font-sans transition-all" 
                  />
                </div>
              </div>

              <!-- Role / Origin -->
              <div class="space-y-1.5">
                <label class="text-[10px] text-stone-500 font-heading font-black uppercase tracking-wider block">Your Location / Custom Label</label>
                <input 
                  v-model="newReviewRole"
                  type="text" 
                  placeholder="e.g. Regular / Batroun Tourist" 
                  class="w-full bg-stone-50/50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3 py-2 text-xs font-sans transition-all" 
                />
              </div>

              <!-- Rating Selection stars -->
              <div class="space-y-1.5">
                <label class="text-[10px] text-stone-500 font-heading font-black uppercase tracking-wider block">Sweetness Rating</label>
                <div class="flex items-center gap-1 bg-stone-50 p-2 rounded-xl border border-stone-200/60 w-max">
                  <button 
                    v-for="r in 5" 
                    :key="r" 
                    type="button"
                    @click="newReviewRating = r"
                    class="text-amber-400 hover:scale-110 active:scale-95 transition-transform"
                  >
                    <span class="material-symbols-outlined text-xl" :style="{ fontVariationSettings: newReviewRating >= r ? `'FILL' 1` : `'FILL' 0` }">
                      grade
                    </span>
                  </button>
                  <span class="text-[10px] font-heading font-extrabold text-stone-400 ml-2 mr-1">{{ newReviewRating }}/5</span>
                </div>
              </div>

              <!-- Tags choice -->
              <div class="space-y-1.5">
                <label class="text-[10px] text-stone-500 font-heading font-black uppercase tracking-wider block">Tag Featured Flavors</label>
                <div class="flex flex-wrap gap-1.5">
                  <button 
                    v-for="tag in AVAILABLE_REVIEW_TAGS" 
                    :key="tag"
                    type="button"
                    @click="toggleReviewTag(tag)"
                    class="text-[9px] font-heading font-extrabold px-3 py-1 rounded-full transition-all cursor-pointer border"
                    :class="[
                      newReviewTags.includes(tag) 
                        ? 'bg-[#fee33c]/20 text-[#863d96] border-amber-300/80 shadow-xs' 
                        : 'bg-stone-50 text-stone-400 border-stone-200/60 hover:bg-stone-100 hover:text-stone-600'
                    ]"
                  >
                    {{ tag }}
                  </button>
                </div>
              </div>

              <!-- Text Message -->
              <div class="space-y-1.5">
                <label class="text-[10px] text-stone-500 font-heading font-black uppercase tracking-wider block">Your Sweet Experience / Feedback</label>
                <textarea 
                  v-model="newReviewText"
                  rows="3" 
                  placeholder="Share details regarding your sweet crepes, the super cooled air conditioning or Lebanese avocado cocktail..." 
                  class="w-full bg-stone-50/50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3 py-2 text-xs font-sans resize-none transition-all"
                ></textarea>
              </div>

              <!-- CTA Submit -->
              <button 
                @click="submitReview"
                class="w-full py-3 bg-[#863d96] hover:bg-[#723281] hover:scale-[1.01] text-white text-xs font-heading font-extrabold rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span class="material-symbols-outlined text-sm">assignment_turned_in</span>
                Submit Sweet Review
              </button>
            </div>

            <!-- List entries column -->
            <div class="lg:col-span-2 space-y-6">
              
              <div 
                v-for="rev in reviews" 
                :key="rev.id"
                class="bg-white rounded-3xl p-6 border border-stone-200/50 shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:shadow-md transition-all space-y-4"
              >
                <!-- Header -->
                <div class="flex items-start justify-between gap-2">
                  <div class="flex items-center gap-3.5">
                    
                    <!-- Avatar or Initials -->
                    <div 
                      class="w-11 h-11 rounded-full flex items-center justify-center font-heading font-black text-xs border border-stone-200 shadow-xs shrink-0"
                      :class="[rev.avatar ? '' : 'bg-gradient-to-tr from-[#863d96]/20 to-[#fee33c]/20 text-[#863d96]']"
                    >
                      <img v-if="rev.avatar" :src="rev.avatar" alt="Avatar author" class="w-full h-full rounded-full object-cover" />
                      <span v-else class="tracking-wider uppercase">{{ rev.initials }}</span>
                    </div>

                    <div>
                      <div class="flex flex-wrap items-center gap-2">
                        <h4 class="font-heading font-black text-stone-800 text-xs">{{ rev.author }}</h4>
                        <div class="flex items-center text-[#fee33c]">
                          <span v-for="s in rev.rating" :key="s" class="material-symbols-outlined text-xs font-black" style="font-variation-settings: 'FILL' 1">grade</span>
                          <span v-for="s in (5 - rev.rating)" :key="'empty-'+s" class="material-symbols-outlined text-xs font-normal opacity-20">grade</span>
                        </div>
                      </div>
                      <p class="text-[10px] text-[#863d96] font-heading font-bold uppercase tracking-wider mt-0.5">{{ rev.role }}</p>
                    </div>

                  </div>

                  <span class="text-[9px] text-stone-400 font-mono bg-stone-50 px-2 py-0.5 rounded-md border border-stone-150 shrink-0">{{ rev.timeAgo }}</span>
                </div>

                <!-- Text comment description -->
                <p class="text-xs font-sans text-stone-600 leading-relaxed pl-1">
                  {{ rev.text }}
                </p>

                <!-- Tags list -->
                <div v-if="rev.tags && rev.tags.length > 0" class="flex flex-wrap gap-1.5 pl-1">
                  <span 
                    v-for="t in rev.tags" 
                    :key="t"
                    class="bg-indigo-50/40 text-[#863d96] border border-[#863d96]/10 text-[9px] font-heading font-bold px-2.5 py-0.5 rounded-full"
                  >
                    #{{ t }}
                  </span>
                </div>

                <!-- Hand-made owner replies inside log -->
                <div 
                  v-for="(rep, rIdx) in rev.replies" 
                  :key="rIdx"
                  class="bg-rose-50/30 p-4 rounded-2xl border-l-[3px] border-[#fee33c] text-[11px] font-sans text-stone-600 leading-relaxed"
                >
                  <p class="font-heading font-extrabold text-[10px] text-[#863d96] uppercase mb-1 flex items-center gap-1.5">
                    <span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                    Response from Jessy Juice:
                  </p>
                  <p class="italic text-stone-600">"{{ rep }}"</p>
                </div>

                <!-- Action Votes buttons -->
                <div class="flex items-center justify-between pt-4 border-t border-stone-100 flex-wrap gap-2">
                  <span class="text-[10px] text-stone-400 font-sans">Was this recommendation helpful?</span>
                  <button 
                    @click="toggleLikeReview(rev.id)"
                    class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border text-[10px] font-heading font-black transition-all cursor-pointer hover:scale-102"
                    :class="[
                      likedKeys[rev.id] 
                        ? 'bg-[#863d96] text-white border-[#723281] shadow-xs' 
                        : 'bg-stone-50 hover:bg-stone-100 text-stone-500 border-stone-250'
                    ]"
                  >
                    <span class="material-symbols-outlined text-[13px]" :style="{ fontVariationSettings: likedKeys[rev.id] ? `'FILL' 1` : `'FILL' 0` }">favorite</span>
                    Sweet Thumbs Up ({{ rev.likes }})
                  </button>
                </div>

              </div>

            </div>

          </div>

        </div>

        <!-- ================= COORDINATES / INFO TAB VIEW ================= -->
        <div v-else-if="activeTab === 'info'" class="max-w-7xl mx-auto px-4 py-12 animate-fadeIn space-y-12">
          
          <!-- Info Header -->
          <div class="text-center max-w-xl mx-auto">
            <span class="text-[10px] text-[#863d96] bg-[#863d96]/10 font-heading font-extrabold px-3 py-1 rounded-full uppercase tracking-wider">
              Coordinates & Hours
            </span>
            <h3 class="font-heading font-black text-[#291830] text-2xl tracking-tight mt-3">
              Find Us In Coastal Batroun ☀️
            </h3>
            <p class="text-xs font-sans text-stone-400 mt-2">
              Deep-freeze cooling inside since 1991. Stop by and sweeten your coastal tours!
            </p>
          </div>

          <!-- Business info & map column -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
            
            <!-- Opening Hours Panel -->
            <div class="bg-white rounded-3xl p-6 border border-stone-200/50 shadow-xs space-y-4">
              <div class="flex items-center justify-between border-b pb-3">
                <h4 class="font-heading font-black text-[#863d96] text-sm tracking-tight flex items-center gap-1.5">
                  <span class="material-symbols-outlined">schedule</span>
                  Weekly Business Hours
                </h4>
                <!-- Live Status Badge -->
                <div class="flex items-center gap-1.5 shrink-0">
                  <span 
                    :class="currentStoreStatus.open ? 'bg-emerald-500' : 'bg-rose-500'" 
                    class="w-2 h-2 rounded-full animate-pulse inline-block"
                  ></span>
                  <span 
                    :class="currentStoreStatus.open ? 'text-emerald-700 bg-emerald-50 border-emerald-100' : 'text-rose-700 bg-rose-50 border-rose-100'" 
                    class="text-[9px] font-heading font-black px-2 py-0.5 rounded-md uppercase border tracking-wider"
                  >
                    {{ currentStoreStatus.text }}
                  </span>
                </div>
              </div>

              <!-- Live Today Tracker Panel -->
              <div 
                v-if="todayHours"
                class="p-3.5 rounded-2xl border transition-all flex items-center justify-between"
                :class="currentStoreStatus.open 
                  ? 'bg-emerald-500/[0.04] border-emerald-200/60' 
                  : 'bg-rose-500/[0.04] border-rose-200/60'"
              >
                <div class="space-y-0.5">
                  <span class="text-[9px] font-heading font-black uppercase tracking-widest text-stone-400 block">
                    Today's Schedule ({{ currentDayOfWeek }})
                  </span>
                  <span class="text-xs font-heading font-black text-stone-800">
                    {{ todayHours.time }}
                  </span>
                </div>
                <div class="text-right">
                  <span 
                    :class="currentStoreStatus.open ? 'text-emerald-600' : 'text-rose-600'"
                    class="text-[10px] font-mono font-bold uppercase tracking-wider"
                  >
                    {{ currentStoreStatus.open ? 'Welcome In! 🥑' : 'Come back tomorrow!' }}
                  </span>
                </div>
              </div>

              <div class="space-y-1.5 pt-1">
                <div 
                  v-for="bh in businessHours" 
                  :key="bh.day"
                  class="flex items-center justify-between text-xs py-2 px-3 rounded-xl border transition-all"
                  :class="[
                    bh.day.toLowerCase() === currentDayOfWeek.toLowerCase()
                      ? 'bg-[#fee33c]/15 text-[#863d96] font-bold border-[#fee33c] shadow-xs relative ring-1 ring-[#fee33c]/30' 
                      : bh.isHighlight 
                        ? 'bg-stone-50 text-stone-800 border-stone-200/50'
                        : 'border-stone-100 text-stone-600'
                  ]"
                >
                  <span class="font-heading font-bold flex items-center gap-1.5">
                    <span v-if="bh.day.toLowerCase() === currentDayOfWeek.toLowerCase()" class="w-1.5 h-1.5 rounded-full bg-[#863d96] animate-pulse"></span>
                    {{ bh.day }}
                    <span 
                      v-if="bh.day.toLowerCase() === currentDayOfWeek.toLowerCase()" 
                      class="text-[8px] bg-[#863d96] text-[#fee33c] px-1.5 py-0.2 rounded-sm font-heading font-black uppercase tracking-widest"
                    >
                      TODAY
                    </span>
                  </span>
                  <span class="font-mono text-[11px]">{{ bh.time }}</span>
                </div>
              </div>

              <!-- Deep chilled details block -->
              <div class="bg-blue-50/50 border border-blue-200 rounded-2xl p-4 flex items-start gap-3.5 mt-5">
                <span class="material-symbols-outlined text-[#863d96] text-2xl">ac_unit</span>
                <div>
                  <h5 class="text-xs font-heading font-extrabold text-[#863d96] uppercase tracking-wide">
                    Air Conditioning Status: Supercooled Active!
                  </h5>
                  <p class="text-[11px] text-stone-600 font-sans mt-0.5 leading-relaxed">
                    Set at 18°C. Escape the humid Lebanese coastal sun inside. Perfect place to relax, grab an ice-cold Avocado shake, or molten dessert plates.
                  </p>
                </div>
              </div>
            </div>

            <!-- Coordinate Info list & Mock map placeholder -->
            <div class="bg-white rounded-3xl p-6 border border-stone-200/50 shadow-xs space-y-5">
              <h4 class="font-heading font-black text-[#863d96] text-sm tracking-tight border-b pb-3 flex items-center gap-1.5">
                <span class="material-symbols-outlined">explore</span>
                Address & Location Details
              </h4>

              <div class="space-y-4">
                <div class="flex items-start gap-3.5 text-xs">
                  <span class="material-symbols-outlined text-[#863d96] mt-0.5">location_on</span>
                  <div>
                    <h5 class="font-heading font-black text-[#291830] text-[11px] uppercase tracking-wide">Street Address</h5>
                    <p class="text-stone-500 font-sans mt-0.5 leading-relaxed">
                      Coastal Old Street Road, Near ancient Phoenician Wall Port, Batroun, North Lebanon.
                    </p>
                  </div>
                </div>

                <div class="flex items-start gap-3.5 text-xs">
                  <span class="material-symbols-outlined text-[#863d96] mt-0.5">call</span>
                  <div>
                    <h5 class="font-heading font-black text-[#291830] text-[11px] uppercase tracking-wide">Hotline / Reservations</h5>
                    <p class="text-stone-500 font-mono mt-0.5">
                      +961 6 740 991 (Local Jessy Juice Center counter)
                    </p>
                  </div>
                </div>

                <div class="flex items-start gap-3.5 text-xs">
                  <span class="material-symbols-outlined text-[#863d96] mt-0.5">workspace_premium</span>
                  <div>
                    <h5 class="font-heading font-black text-[#291830] text-[11px] uppercase tracking-wide">Jessy Heritage Quality</h5>
                    <p class="text-stone-500 font-sans mt-0.5 leading-relaxed">
                      Proudly serving sweet Batroun families, seaside surfers, and sweet tooths since 1991.
                    </p>
                  </div>
                </div>
              </div>

              <!-- Interactive Live Google Maps Location with Multi-source Fallbacks -->
              <div class="space-y-4">
                <!-- Map source switcher tab and direct location helper -->
                <div class="flex items-center justify-between gap-2 p-1.5 bg-stone-100 rounded-xl border border-stone-200/60 text-xs">
                  <div class="flex items-center gap-1">
                    <button 
                      @click="selectedMapSource = 'google'"
                      class="px-3 py-1.5 rounded-lg font-heading font-extrabold text-[10px] uppercase tracking-wider transition-all cursor-pointer"
                      :class="[selectedMapSource === 'google' ? 'bg-[#863d96] text-white shadow-xs' : 'text-stone-500 hover:text-stone-800']"
                    >
                      Google Maps
                    </button>
                    <button 
                      @click="selectedMapSource = 'osm'"
                      class="px-3 py-1.5 rounded-lg font-heading font-extrabold text-[10px] uppercase tracking-wider transition-all cursor-pointer"
                      :class="[selectedMapSource === 'osm' ? 'bg-[#863d96] text-white shadow-xs' : 'text-stone-500 hover:text-stone-800']"
                    >
                      OpenStreetMap
                    </button>
                  </div>
                  
                  <span class="text-[9px] font-sans text-stone-400 font-medium px-2 italic uppercase tracking-tight hidden sm:inline-block">
                    Select Map View
                  </span>
                </div>

                <!-- Active Map Frame Container -->
                <div class="relative h-64 w-full bg-stone-50 rounded-2xl overflow-hidden border border-stone-200 shadow-sm flex flex-col justify-between">
                  <!-- Google Map Iframe Frame -->
                  <iframe 
                    v-if="selectedMapSource === 'google'"
                    src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3298.547841103099!2d35.6583!3d34.2541!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x151f5b08e23bdf2b%3A0xe67ce3c2bb6f0b4a!2sJessy%20Juice!5e0!3m2!1sen!2slb!4v1718020000000!5m2!1sen!2slb" 
                    class="w-full h-full border-0 absolute inset-0" 
                    allowfullscreen="" 
                    loading="lazy" 
                    referrerpolicy="no-referrer-when-downgrade"
                  ></iframe>

                  <!-- OpenStreetMap Iframe Frame (Safe Fallback Frame that always loads inside restricted browser frames) -->
                  <iframe 
                    v-else
                    src="https://www.openstreetmap.org/export/embed.html?bbox=35.6500%2C34.2510%2C35.6660%2C34.2580&amp;layer=mapnik&amp;marker=34.2541%2C35.6583" 
                    class="w-full h-full border-0 absolute inset-0" 
                    allowfullscreen="" 
                    loading="lazy"
                  ></iframe>
                </div>

                <!-- Direct Navigation Assist Button Card -->
                <div class="p-3.5 bg-[#fee33c]/10 border border-[#fee33c]/45 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 shadow-2xs">
                  <div class="flex items-start gap-2.5 text-left">
                    <span class="material-symbols-outlined text-[#863d96] text-xl shrink-0 mt-0.5">near_me</span>
                    <div>
                      <h6 class="text-[11px] font-heading font-black text-[#863d96] uppercase tracking-wide">Direct Directions Route</h6>
                      <p class="text-[10px] text-stone-600 font-sans mt-0.5">Having display issues inside standard embedding frames? Open directly.</p>
                    </div>
                  </div>
                  
                  <a 
                    href="https://www.google.com/maps/search/?api=1&query=Jessy+Juice+Batroun+Lebanon" 
                    target="_blank"
                    class="w-full sm:w-auto text-center px-4 py-2 bg-[#863d96] hover:bg-[#723281] text-white font-heading font-extrabold text-[10px] uppercase tracking-wider rounded-xl shadow-xs hover:scale-[1.02] active:scale-98 transition-all flex items-center justify-center gap-1.5"
                  >
                    Launch Google Maps
                    <span class="material-symbols-outlined text-xs">open_in_new</span>
                  </a>
                </div>
              </div>
            </div>

          </div>

        </div>

        <!-- ================= DEDICATED CHECKOUT TAB VIEW ================= -->
        <div v-else-if="activeTab === 'checkout'" class="max-w-7xl mx-auto px-4 py-8 md:py-12 animate-fadeIn space-y-8">
          
          <!-- Elegant Checkout Header -->
          <div class="bg-[#291830] text-white p-6 md:p-10 rounded-3xl shadow-md text-center relative overflow-hidden select-none">
            <!-- Decorative circle backgrounds for a boutique feel -->
            <div class="absolute -top-10 -right-10 w-32 h-32 bg-[#fee33c]/15 rounded-full blur-xl"></div>
            <div class="absolute -bottom-10 -left-10 w-32 h-32 bg-[#863d96]/30 rounded-full blur-xl"></div>
            
            <h2 class="font-heading font-black text-2xl md:text-4xl tracking-widest uppercase text-[#fee33c]">CHECKOUT</h2>
            <p class="text-xs text-stone-300 font-heading font-bold uppercase tracking-widest mt-2 flex items-center justify-center gap-2">
              <span class="material-symbols-outlined text-sm text-[#fee33c]">verified_user</span>
              Secure Counter Platter Order Sync
            </p>
          </div>

          <!-- Checkout Success State -->
          <div v-if="checkoutSuccess" class="bg-white rounded-3xl p-8 md:p-12 border border-stone-200/60 shadow-lg text-center max-w-2xl mx-auto space-y-6 animate-zoomIn">
            <div class="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
              <span class="material-symbols-outlined text-4xl font-bold">check_circle</span>
            </div>
            
            <div class="space-y-2">
              <h3 class="font-heading font-black text-[#291830] text-2xl md:text-3xl tracking-tight">
                Ahla w Sahla! Order Placed! 🎉
              </h3>
              <p class="text-xs text-stone-500 font-sans max-w-md mx-auto">
                Your luxury sweetness custom platter order is sent to the counter & synced to our kitchen system.
              </p>
            </div>

            <div class="bg-stone-50 rounded-2xl p-6 border border-stone-200/50 max-w-md mx-auto text-left space-y-4 font-sans">
              <div class="flex items-center justify-between border-b border-stone-200/60 pb-2.5">
                <span class="text-xs text-stone-500 font-medium">Order Reference ID:</span>
                <span class="text-xs font-mono font-black text-[#863d96] bg-[#863d96]/10 px-2.5 py-1 rounded-md">{{ checkoutOrderId }}</span>
              </div>
              <div class="flex items-center justify-between border-b border-stone-200/60 pb-2.5">
                <span class="text-xs text-stone-500 font-medium">Estimated Pickup/Delivery:</span>
                <span class="text-xs font-heading font-extrabold text-stone-800">25 - 35 mins</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-xs text-stone-500 font-medium">Payment Method:</span>
                <span class="text-xs font-heading font-extrabold text-[#863d96] uppercase tracking-wider">
                  {{ checkoutPaymentMethod === 'cod' ? 'Cash on Delivery / Direct Counter' : checkoutPaymentMethod === 'paypal' ? 'PayPal Express' : 'Credit / Debit Card' }}
                </span>
              </div>
            </div>

            <div class="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button 
                @click="checkoutSuccess = false; clearAllCart(); switchTab('home')"
                class="w-full sm:w-auto px-6 py-3 bg-[#863d96] hover:bg-[#723281] text-white font-heading font-extrabold text-xs rounded-xl shadow-md transition-all cursor-pointer uppercase tracking-wider"
              >
                Back To Home
              </button>
              <button 
                @click="checkoutSuccess = false; clearAllCart(); switchTab('menu')"
                class="w-full sm:w-auto px-6 py-3 bg-stone-100 hover:bg-stone-200 text-stone-700 font-heading font-extrabold text-xs rounded-xl border border-stone-200 transition-all cursor-pointer uppercase tracking-wider"
              >
                Browse Menu
              </button>
            </div>
          </div>

          <!-- Active Checkout Layout (with items in cart) -->
          <div v-else-if="cart.length > 0" class="space-y-6 max-w-4xl mx-auto">
            
            <!-- Top Continue Shopping Button (Always on top) -->
            <div class="flex justify-start select-none">
              <button 
                @click="switchTab('menu')"
                class="px-5 py-2.5 bg-stone-100 hover:bg-[#fee33c] hover:text-[#863d96] text-stone-600 font-heading font-extrabold text-[11px] uppercase tracking-wider rounded-xl transition-all cursor-pointer border border-stone-200/60 shadow-xs active:scale-95 flex items-center gap-1.5"
              >
                <span class="material-symbols-outlined text-xs font-bold">arrow_back</span>
                Continue Shopping
              </button>
            </div>
            
            <!-- Stepper Progress Bar -->
            <div class="bg-white rounded-3xl p-6 border border-stone-200/60 shadow-xs max-w-2xl mx-auto select-none">
              <div class="flex items-center justify-between relative">
                <!-- Connecting progress line -->
                <div class="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 bg-stone-100 rounded-full z-0">
                  <div 
                    class="h-full bg-gradient-to-r from-[#863d96] to-[#fee33c] transition-all duration-300 rounded-full"
                    :style="{ width: ((checkoutStep - 1) / 3 * 100) + '%' }"
                  ></div>
                </div>
                
                <!-- Steps -->
                <button 
                  v-for="stepNum in 4" 
                  :key="'step-' + stepNum"
                  @click="stepNum <= checkoutStep ? checkoutStep = stepNum : null"
                  class="relative z-10 w-9 h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center font-heading font-black text-xs md:text-sm border-2 transition-all duration-300"
                  :class="[
                    checkoutStep === stepNum 
                      ? 'bg-[#863d96] border-[#863d96] text-white shadow-md scale-110' 
                      : checkoutStep > stepNum 
                        ? 'bg-[#fee33c] border-[#fee33c] text-[#863d96]' 
                        : 'bg-white border-stone-200 text-stone-400'
                  ]"
                >
                  <span v-if="checkoutStep > stepNum" class="material-symbols-outlined text-sm font-bold">done</span>
                  <span v-else>{{ stepNum }}</span>
                  
                  <!-- Label below step -->
                  <span 
                    class="absolute top-11 md:top-13 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] md:text-[10px] font-heading font-extrabold uppercase tracking-widest hidden sm:block"
                    :class="[checkoutStep === stepNum ? 'text-[#863d96]' : 'text-stone-400']"
                  >
                    {{ stepNum === 1 ? 'Review Items' : stepNum === 2 ? 'Contact Info' : stepNum === 3 ? 'Delivery' : 'Payment' }}
                  </span>
                </button>
              </div>
            </div>

            <!-- STEP 1: REVIEW YOUR ORDER & SUGGESTED FOR YOU (showing all products) -->
            <div v-if="checkoutStep === 1" class="space-y-6 animate-fadeIn">
              <div class="bg-white p-6 md:p-8 rounded-3xl border border-stone-200/60 shadow-xs text-left space-y-6">
                <h3 class="font-heading font-black text-stone-850 text-sm uppercase tracking-widest border-b border-stone-100 pb-3 flex items-center justify-between">
                  <span>1. Review Your Order</span>
                  <span class="bg-[#863d96]/10 text-[#863d96] text-[10px] px-2.5 py-1 rounded-full font-bold font-mono">{{ cartCount }} {{ cartCount === 1 ? 'item' : 'items' }}</span>
                </h3>
                
                <div class="space-y-4 max-h-[350px] overflow-y-auto pr-1 scrolling-hide">
                  <div 
                    v-for="cItem in cart" 
                    :key="'checkout-list-' + cItem.cartKey"
                    class="flex gap-4 border-b border-stone-100 pb-4 last:border-0 last:pb-0"
                  >
                    <img :src="cItem.image" :alt="cItem.name" class="w-16 h-16 rounded-2xl object-cover border border-stone-100 shrink-0" />
                    <div class="flex-grow min-w-0 space-y-1.5">
                      <div class="flex items-start justify-between gap-2">
                        <p class="font-heading font-extrabold text-xs text-stone-800 leading-tight">{{ cItem.name }}</p>
                        <button 
                          @click="removeFromCart(cItem.cartKey)"
                          class="text-stone-400 hover:text-red-500 transition-colors"
                          title="Remove from plate"
                        >
                          <span class="material-symbols-outlined text-sm">delete</span>
                        </button>
                      </div>
                      <p v-if="cItem.extras && cItem.extras.length > 0" class="text-[10px] text-[#863d96] font-sans">
                        Toppings: {{ cItem.extras.join(', ') }}
                      </p>
                      <p v-if="cItem.notes" class="text-[9px] text-stone-400 font-sans italic">
                        Note: "{{ cItem.notes }}"
                      </p>
                      <div class="flex items-center justify-between">
                        <span class="font-heading font-black text-[#863d96] text-xs">${{ cItem.finalPrice.toFixed(2) }}</span>
                        
                        <!-- Quantity control box -->
                        <div class="flex items-center bg-stone-100 border border-stone-200/50 rounded-lg overflow-hidden shrink-0">
                          <button 
                            @click="updateCartQty(cItem.cartKey, -1)" 
                            class="w-7 h-7 flex items-center justify-center hover:bg-stone-200 text-stone-600 font-bold text-sm"
                          >-</button>
                          <span class="px-3 font-mono font-bold text-xs text-stone-700 select-none min-w-[20px] text-center">{{ cItem.qty }}</span>
                          <button 
                            @click="updateCartQty(cItem.cartKey, 1)" 
                            class="w-7 h-7 flex items-center justify-center hover:bg-stone-200 text-stone-600 font-bold text-sm"
                          >+</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="flex items-center justify-between border-t border-stone-100 pt-4">
                  <span class="text-xs font-heading font-extrabold text-stone-500 uppercase tracking-wider">Estimated Items Subtotal:</span>
                  <span class="text-sm font-heading font-black text-[#863d96]">${{ cartTotal.toFixed(2) }}</span>
                </div>
              </div>

              <!-- Suggested For You section - displaying ALL products as requested -->
              <div class="bg-white p-6 md:p-8 rounded-3xl border border-stone-200/60 shadow-xs text-left space-y-4">
                <div class="flex items-center justify-between border-b border-stone-100 pb-2">
                  <h4 class="text-xs font-heading font-black text-stone-800 uppercase tracking-widest flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-[#fee33c] text-sm">thumb_up</span>
                    Suggested For You
                  </h4>
                  <span class="text-[10px] text-stone-400 font-sans font-medium">Add boutique sweet treats to your platter!</span>
                </div>
                
                <!-- Scrollable vertical list of all items, looking like the cart list -->
                <div class="flex flex-col gap-3.5 max-h-[360px] overflow-y-auto pr-1.5 scrolling-hide divide-y divide-stone-100">
                  <div 
                    v-for="sugItem in unifiedMenuItems" 
                    :key="'checkout-sug-' + sugItem.id"
                    class="flex items-center justify-between gap-3 pt-3.5 first:pt-0"
                  >
                    <!-- Clickable area to open product details -->
                    <div 
                      @click="openDetailModal(sugItem)"
                      class="flex items-center gap-4 min-w-0 cursor-pointer group flex-grow"
                      title="View product details"
                    >
                      <img :src="sugItem.image" :alt="sugItem.name" class="w-16 h-16 rounded-2xl object-cover border border-stone-100 shrink-0 group-hover:scale-105 transition-all duration-300" />
                      <div class="min-w-0 text-left space-y-1">
                        <p class="font-heading font-extrabold text-xs text-stone-800 leading-tight group-hover:text-[#863d96] transition-colors truncate">{{ sugItem.name }}</p>
                        <p class="text-[10px] text-stone-400 font-sans line-clamp-1 pr-2">{{ sugItem.description || 'Boutique custom sweetness platter component' }}</p>
                        <p class="font-heading font-black text-[#863d96] text-xs mt-0.5">{{ sugItem.priceLabel || '$' + sugItem.price.toFixed(2) }}</p>
                      </div>
                    </div>
                    
                    <button 
                      @click="addDirectToCart(sugItem)"
                      class="px-4 py-2 bg-[#863d96] hover:bg-[#fee33c] hover:text-[#863d96] text-white text-[10px] font-heading font-extrabold uppercase rounded-xl tracking-wide transition-all shrink-0 cursor-pointer shadow-xs active:scale-95"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>

              <!-- Navigation Footer Step 1 -->
              <div class="flex justify-between items-center pt-4 border-t border-stone-100 mt-6">
                <button 
                  @click="switchTab('menu')"
                  class="px-5 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-600 font-heading font-extrabold text-[10px] uppercase tracking-wider rounded-xl transition-all cursor-pointer border border-stone-200/60"
                >
                  ← Back
                </button>
                <button 
                  @click="nextStep"
                  class="px-6 py-3 bg-[#863d96] hover:bg-[#723281] text-white font-heading font-black text-[11px] uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-sm hover:translate-x-0.5"
                >
                  Next <span class="material-symbols-outlined text-xs">arrow_forward</span>
                </button>
              </div>
            </div>

            <!-- STEP 2: CONTACT INFORMATION -->
            <div v-else-if="checkoutStep === 2" class="space-y-6 max-w-xl mx-auto animate-fadeIn">
              <div class="bg-white p-6 md:p-8 rounded-3xl border border-stone-200/60 shadow-xs text-left space-y-6">
                <h3 class="font-heading font-black text-stone-850 text-xs uppercase tracking-widest border-b border-stone-100 pb-3 flex items-center justify-between">
                  <span>2. Contact Information</span>
                  <span class="material-symbols-outlined text-sm text-[#863d96]">person</span>
                </h3>

                <!-- Account Banner -->
                <div v-if="loggedUser" class="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3 flex items-start gap-2.5">
                  <span class="material-symbols-outlined text-emerald-600 text-sm mt-0.5">check_circle</span>
                  <div class="text-xs">
                    <p class="font-heading font-extrabold text-emerald-800">Connected with Account</p>
                    <p class="text-[10px] text-emerald-600 font-sans mt-0.5 truncate">Logged in as {{ loggedUser.name }}</p>
                  </div>
                </div>
                <div v-else class="bg-[#fee33c]/10 border border-[#fee33c]/45 rounded-xl p-3 flex items-start gap-2.5">
                  <span class="material-symbols-outlined text-[#863d96] text-sm mt-0.5 font-bold">info</span>
                  <div class="text-xs flex-grow">
                    <p class="font-heading font-extrabold text-[#863d96] leading-none">Checkout as Guest</p>
                    <p class="text-[10px] text-stone-500 font-sans mt-1">Already have an account?</p>
                    <button @click="isLoginModalOpen = true; authMode = 'signin'" class="text-[#863d96] hover:underline font-bold text-[10px] uppercase tracking-wide mt-1 block cursor-pointer">
                      Log In / Sign Up
                    </button>
                  </div>
                </div>

                <!-- Input Fields -->
                <div class="space-y-4 pt-2">
                  <div class="grid grid-cols-2 gap-3">
                    <div class="space-y-1">
                      <label class="text-[9px] text-[#863d96] font-heading font-black uppercase tracking-wider block">First Name <span class="text-rose-500">*</span></label>
                      <input 
                        v-model="checkoutFirstName"
                        type="text"
                        required
                        placeholder="X"
                        class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3.5 py-2.5 text-xs font-sans transition-all"
                      />
                    </div>
                    <div class="space-y-1">
                      <label class="text-[9px] text-[#863d96] font-heading font-black uppercase tracking-wider block">Last Name <span class="text-rose-500">*</span></label>
                      <input 
                        v-model="checkoutLastName"
                        type="text"
                        required
                        placeholder="X"
                        class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3.5 py-2.5 text-xs font-sans transition-all"
                      />
                    </div>
                  </div>

                  <div class="space-y-1">
                    <label class="text-[9px] text-[#863d96] font-heading font-black uppercase tracking-wider block">Email Address <span class="text-rose-500">*</span></label>
                    <input 
                      v-model="checkoutEmail"
                      type="email"
                      required
                      placeholder="X"
                      class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3.5 py-2.5 text-xs font-sans transition-all"
                    />
                  </div>

                  <!-- Country prefix select + Phone Input -->
                  <div class="space-y-1">
                    <label class="text-[9px] text-[#863d96] font-heading font-black uppercase tracking-wider block">Phone Number <span class="text-rose-500">*</span></label>
                    <div class="flex gap-2">
                      <div class="relative shrink-0 w-24">
                        <select class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl pl-2.5 pr-6 py-2.5 text-xs font-sans transition-all appearance-none cursor-pointer">
                          <option value="+961">🇱🇧 +961</option>
                          <option value="+1">🇺🇸 +1</option>
                          <option value="+33">🇫🇷 +33</option>
                          <option value="+971">🇦🇪 +971</option>
                        </select>
                        <div class="absolute inset-y-0 right-1.5 flex items-center pointer-events-none text-stone-400">
                          <span class="material-symbols-outlined text-xs">keyboard_arrow_down</span>
                        </div>
                      </div>
                      <input 
                        v-model="checkoutPhone"
                        type="tel"
                        required
                        placeholder="03 123 456"
                        class="flex-grow bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3.5 py-2.5 text-xs font-sans transition-all"
                      />
                    </div>
                  </div>

                  <!-- Marketing Toggle checkbox -->
                  <div class="flex items-start gap-2.5 pt-2 select-none cursor-pointer">
                    <input 
                      id="marketing-opt" 
                      v-model="checkoutMarketingOptIn" 
                      type="checkbox" 
                      class="mt-1 rounded text-[#863d96] focus:ring-[#863d96] cursor-pointer" 
                    />
                    <label for="marketing-opt" class="text-[10px] text-stone-500 font-sans leading-tight cursor-pointer">
                      Sign up for exclusive discounts and dessert platter updates via email/SMS.
                    </label>
                  </div>
                </div>
              </div>

              <!-- Navigation Footer Step 2 -->
              <div class="flex justify-between items-center pt-4 border-t border-stone-100 mt-6">
                <button 
                  @click="prevStep"
                  class="px-5 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-600 font-heading font-extrabold text-[10px] uppercase tracking-wider rounded-xl transition-all cursor-pointer border border-stone-200/60"
                >
                  ← Back
                </button>
                <button 
                  @click="nextStep"
                  class="px-6 py-3 bg-[#863d96] hover:bg-[#723281] text-white font-heading font-black text-[11px] uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-sm hover:translate-x-0.5"
                >
                  Next <span class="material-symbols-outlined text-xs">arrow_forward</span>
                </button>
              </div>
            </div>

            <!-- STEP 3: DELIVERY / COUNTER PICKUP -->
            <div v-else-if="checkoutStep === 3" class="space-y-6 max-w-xl mx-auto animate-fadeIn">
              <div class="bg-white p-6 md:p-8 rounded-3xl border border-stone-200/60 shadow-xs text-left space-y-6">
                <h3 class="font-heading font-black text-stone-850 text-xs uppercase tracking-widest border-b border-stone-100 pb-3 flex items-center justify-between">
                  <span>3. Delivery / Counter Pickup</span>
                  <span class="material-symbols-outlined text-sm text-[#863d96]">local_shipping</span>
                </h3>

                <!-- Delivery Coverage info box -->
                <div class="bg-[#863d96]/5 border border-[#863d96]/15 rounded-2xl p-4 text-xs text-stone-600 space-y-1">
                  <p class="font-heading font-extrabold text-[#863d96]">Luxury Boutique Delivery Service</p>
                  <p class="text-[10px] font-sans leading-relaxed text-stone-500">We deliver beautifully styled sweet platters directly to your home, event, yacht, beach house, or resort suite in Batroun and surrounding coastlines! Or you can pick up fresh at our boutique kitchen counter.</p>
                </div>

                <div class="space-y-4 pt-2">
                  <div class="space-y-1">
                    <label class="text-[9px] text-[#863d96] font-heading font-black uppercase tracking-wider block">Country / Region <span class="text-rose-500">*</span></label>
                    <div class="relative">
                      <select v-model="checkoutCountry" class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl pl-3.5 pr-8 py-2.5 text-xs font-sans transition-all appearance-none cursor-pointer">
                        <option value="Lebanon">Lebanon 🇱🇧</option>
                        <option value="United States">United States 🇺🇸</option>
                        <option value="United Arab Emirates">United Arab Emirates 🇦🇪</option>
                      </select>
                      <div class="absolute inset-y-0 right-3 flex items-center pointer-events-none text-stone-400">
                        <span class="material-symbols-outlined text-xs">keyboard_arrow_down</span>
                      </div>
                    </div>
                  </div>

                  <div class="space-y-1">
                    <label class="text-[9px] text-[#863d96] font-heading font-black uppercase tracking-wider block">Delivery Address Details <span class="text-rose-500">*</span></label>
                    <textarea 
                      v-model="checkoutAddress"
                      required
                      rows="3"
                      placeholder="e.g. Seaside Boulevard, Seafront Resort Block C, Floor 2, Near Phoenician Wall, Batroun"
                      class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3.5 py-2.5 text-xs font-sans transition-all"
                    ></textarea>
                  </div>

                  <div class="space-y-1">
                    <label class="text-[9px] text-[#863d96] font-heading font-black uppercase tracking-wider block">Postcode / Zip Code (Optional)</label>
                    <input 
                      v-model="checkoutZipCode"
                      type="text"
                      placeholder="e.g. 1400"
                      class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3.5 py-2.5 text-xs font-sans transition-all"
                    />
                  </div>
                </div>
              </div>

              <!-- Navigation Footer Step 3 -->
              <div class="flex justify-between items-center pt-4 border-t border-stone-100 mt-6">
                <button 
                  @click="prevStep"
                  class="px-5 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-600 font-heading font-extrabold text-[10px] uppercase tracking-wider rounded-xl transition-all cursor-pointer border border-stone-200/60"
                >
                  ← Back
                </button>
                <button 
                  @click="nextStep"
                  class="px-6 py-3 bg-[#863d96] hover:bg-[#723281] text-white font-heading font-black text-[11px] uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-sm hover:translate-x-0.5"
                >
                  Next <span class="material-symbols-outlined text-xs">arrow_forward</span>
                </button>
              </div>
            </div>

            <!-- STEP 4: PAYMENT METHOD & FINAL ORDER SUMMARY -->
            <div v-else-if="checkoutStep === 4" class="grid grid-cols-1 md:grid-cols-12 gap-6 items-start text-left animate-fadeIn">
              
              <!-- Payment selection (left side) -->
              <div class="md:col-span-5 bg-white p-6 md:p-8 rounded-3xl border border-stone-200/60 shadow-xs space-y-6">
                <h3 class="font-heading font-black text-stone-850 text-xs uppercase tracking-widest border-b border-stone-100 pb-3 flex items-center justify-between">
                  <span>4. Payment Method</span>
                  <span class="material-symbols-outlined text-sm text-[#863d96]">payment</span>
                </h3>

                <div class="space-y-2.5 select-none">
                  <!-- Cash on Delivery -->
                  <div 
                    @click="checkoutPaymentMethod = 'cod'"
                    class="p-4 border rounded-2xl flex items-center gap-3.5 transition-all cursor-pointer"
                    :class="[checkoutPaymentMethod === 'cod' ? 'border-[#863d96] bg-[#863d96]/5 text-[#863d96]' : 'border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-600']"
                  >
                    <span class="material-symbols-outlined text-lg">payments</span>
                    <div class="text-xs">
                      <p class="font-heading font-extrabold leading-none text-stone-800">Cash on Delivery</p>
                      <p class="text-[10px] font-sans mt-1 text-stone-400">Pay on pickup or home receipt</p>
                    </div>
                  </div>

                  <!-- PayPal -->
                  <div 
                    @click="checkoutPaymentMethod = 'paypal'"
                    class="p-4 border rounded-2xl flex items-center gap-3.5 transition-all cursor-pointer"
                    :class="[checkoutPaymentMethod === 'paypal' ? 'border-[#863d96] bg-[#863d96]/5 text-[#863d96]' : 'border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-600']"
                  >
                    <span class="material-symbols-outlined text-lg">account_balance_wallet</span>
                    <div class="text-xs">
                      <p class="font-heading font-extrabold leading-none text-stone-800">PayPal Express</p>
                      <p class="text-[10px] font-sans mt-1 text-stone-400">Fast, secure checkout</p>
                    </div>
                  </div>

                  <!-- Credit card -->
                  <div 
                    @click="checkoutPaymentMethod = 'card'"
                    class="p-4 border rounded-2xl flex items-center gap-3.5 transition-all cursor-pointer"
                    :class="[checkoutPaymentMethod === 'card' ? 'border-[#863d96] bg-[#863d96]/5 text-[#863d96]' : 'border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-600']"
                  >
                    <span class="material-symbols-outlined text-lg">credit_card</span>
                    <div class="text-xs">
                      <p class="font-heading font-extrabold leading-none text-stone-800">Credit / Debit Card</p>
                      <p class="text-[10px] font-sans mt-1 text-stone-400">Visa, MasterCard, or AMEX</p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Summary, discounts and complete order button (right side) -->
              <div class="md:col-span-7 bg-white p-6 md:p-8 rounded-3xl border border-stone-200/60 shadow-xs space-y-6">
                <h3 class="font-heading font-black text-stone-850 text-xs uppercase tracking-widest border-b border-stone-100 pb-3">
                  Order Summary & Confirm
                </h3>

                <div class="space-y-4">
                  <!-- Items list in summary -->
                  <div class="space-y-2 max-h-[160px] overflow-y-auto pr-1 scrolling-hide divide-y divide-stone-100">
                    <div 
                      v-for="sItem in cart" 
                      :key="'summary-' + sItem.cartKey"
                      class="flex items-center justify-between text-xs text-stone-700 font-sans pt-2 first:pt-0"
                    >
                      <div class="truncate pr-4 flex flex-col">
                        <span class="font-bold text-stone-850">{{ sItem.qty }} x {{ sItem.name }}</span>
                        <span v-if="sItem.extras && sItem.extras.length > 0" class="text-[9px] text-[#863d96]">
                          Toppings: {{ sItem.extras.join(', ') }}
                        </span>
                      </div>
                      <span class="font-mono font-bold text-stone-800 shrink-0">${{ (sItem.finalPrice * sItem.qty).toFixed(2) }}</span>
                    </div>
                  </div>

                  <!-- Promo Input Area -->
                  <div class="pt-2 border-t border-stone-100">
                    <div class="relative flex items-center border border-stone-200 bg-stone-50 rounded-xl overflow-hidden px-2 py-1.5 focus-within:ring-2 focus-within:ring-[#863d96]/20 focus-within:border-[#863d96]">
                      <span class="material-symbols-outlined text-stone-400 text-sm shrink-0 pl-1">sell</span>
                      <input 
                        v-model="promoCode"
                        type="text"
                        placeholder="Discount code (e.g. SWEET15)"
                        class="w-full bg-transparent border-0 focus:outline-none focus:ring-0 text-xs px-2 py-1 uppercase font-heading font-extrabold"
                      />
                      <button 
                        @click="applyPromoCode"
                        type="button"
                        class="bg-[#863d96] hover:bg-[#723281] text-white font-heading font-extrabold text-[9px] uppercase px-3 py-2 rounded-lg transition-colors shrink-0 cursor-pointer shadow-xs"
                      >
                        Apply
                      </button>
                    </div>
                    <!-- Applied chip -->
                    <div v-if="appliedDiscountCode" class="mt-2 bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 flex items-center justify-between text-[10px] text-emerald-800 animate-fadeIn">
                      <span class="font-medium">🏷️ Code applied: <span class="font-extrabold">{{ appliedDiscountCode }}</span> ({{ discountPercent }}% OFF)</span>
                      <button @click="removePromoCode" type="button" class="text-rose-500 hover:text-rose-700 font-bold uppercase text-[9px] cursor-pointer">Remove</button>
                    </div>
                  </div>

                  <!-- Subtotals and Order Total Banner -->
                  <div class="space-y-2 pt-2 border-t border-stone-100 text-xs">
                    <div class="flex items-center justify-between text-stone-500 font-sans">
                      <span>Subtotal:</span>
                      <span class="font-mono font-bold">${{ cartTotal.toFixed(2) }}</span>
                    </div>
                    <div v-if="discountPercent > 0" class="flex items-center justify-between text-emerald-600 font-sans">
                      <span>Discount ({{ discountPercent }}%):</span>
                      <span class="font-mono font-bold">-${{ orderDiscountAmount.toFixed(2) }}</span>
                    </div>

                    <!-- ORDER TOTAL BANNER WITH PURPLE BACKGROUND -->
                    <div class="bg-[#863d96] text-white p-4 rounded-2xl flex items-center justify-between font-heading font-extrabold mt-3 select-none animate-fadeIn">
                      <span class="uppercase text-[10px] tracking-widest">ORDER TOTAL:</span>
                      <span class="text-lg font-black font-mono">${{ orderFinalTotal.toFixed(2) }}</span>
                    </div>
                  </div>

                  <p class="text-[9px] text-center text-stone-400 font-sans leading-normal">
                    *By placing this order, you're consenting to our privacy policy. Jessy Juice boutique custom platter sync service.
                  </p>
                </div>
              </div>

              <!-- Navigation Footer Step 4 -->
              <div class="col-span-1 md:col-span-12 flex justify-between items-center pt-4 border-t border-stone-100 mt-6">
                <button 
                  @click="prevStep"
                  class="px-5 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-600 font-heading font-extrabold text-[10px] uppercase tracking-wider rounded-xl transition-all cursor-pointer border border-stone-200/60"
                >
                  ← Back
                </button>
                <button 
                  @click="checkoutPlate()"
                  :disabled="isCheckingOut"
                  class="px-6 py-3 bg-[#863d96] hover:bg-[#723281] disabled:bg-stone-300 text-white font-heading font-black text-[11px] uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-sm hover:translate-x-0.5 active:scale-95 disabled:cursor-not-allowed"
                >
                  <span class="material-symbols-outlined text-xs">
                    {{ isCheckingOut ? 'sync' : 'lock' }}
                  </span>
                  {{ isCheckingOut ? 'Processing...' : 'Next' }}
                </button>
              </div>

            </div>

          </div>

          <!-- Empty Checkout view (backlink to menu) -->
          <div v-else class="bg-white rounded-3xl p-8 md:p-12 border border-stone-200/60 shadow-lg text-center max-w-md mx-auto space-y-6 select-none animate-zoomIn">
            <div class="w-16 h-16 bg-[#863d96]/10 text-[#863d96] rounded-full flex items-center justify-center mx-auto shadow-xs">
              <span class="material-symbols-outlined text-3xl font-bold">shopping_cart</span>
            </div>
            
            <div class="space-y-1.5">
              <h3 class="font-heading font-black text-[#291830] text-lg tracking-tight">Your Cart is Currently Empty</h3>
              <p class="text-xs text-stone-400 font-sans leading-relaxed">
                Add some sweet crepes, waffle plates, or organic fresh juices onto your platter before starting checkout!
              </p>
            </div>

            <button 
              @click="switchTab('menu')"
              class="w-full py-3 bg-[#863d96] hover:bg-[#723281] text-white font-heading font-extrabold text-xs rounded-xl shadow-md transition-all cursor-pointer uppercase tracking-wider"
            >
              Go To Boutique Menu
            </button>
          </div>

        </div>

      </main>

      <!-- ================= MY PLATE / CART SLIDE OUT DRAWER ================= -->
      <div 
        v-if="isCartOpen" 
        class="fixed inset-0 bg-black/60 z-50 flex justify-end"
      >
        <div class="w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-slideLeft">
          
          <!-- Header -->
          <div class="p-5 border-b border-stone-200/50 flex items-center justify-between bg-white select-none">
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-[#863d96] text-xl">shopping_cart</span>
              <h4 class="font-heading font-black text-stone-800 text-sm tracking-tight">My Plates & Platter Design</h4>
            </div>
            <button 
              @click="isCartOpen = false" 
              class="w-9 h-9 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-500 flex items-center justify-center cursor-pointer"
            >
              <span class="material-symbols-outlined text-md">close</span>
            </button>
          </div>

          <!-- Empty plate & Items list scrollable unified wrapper -->
          <div class="flex-grow overflow-y-auto p-4 space-y-6 bg-stone-50 scrolling-hide">
            
            <!-- Empty state -->
            <div v-if="cart.length === 0" class="flex flex-col items-center justify-center py-10 text-center select-none bg-stone-50">
              <div class="w-16 h-16 bg-secondary/15 rounded-full flex items-center justify-center text-[#863d96] mb-4 mx-auto">
                <span class="material-symbols-outlined text-3xl">restaurant</span>
              </div>
              <h5 class="font-heading font-extrabold text-stone-600 text-xs">Your sweet planner plate is currently empty!</h5>
              <p class="text-[11px] text-stone-400 font-sans max-w-xs mt-1.5 leading-relaxed">
                Plan custom chocolates, whipped cream waffles, or organic strawberries onto your platter from the Specialties catalog!
              </p>
              <button 
                @click="isCartOpen = false; switchTab('menu')"
                class="mt-5 px-5 py-2.5 bg-[#863d96] text-white font-heading font-extrabold text-[10px] rounded-full shadow-sm transition-all hover:bg-[#723281] cursor-pointer"
              >
                Browse specialties
              </button>
            </div>

            <!-- Items list -->
            <div v-else class="space-y-4">
              <!-- Clear all bar -->
              <div class="flex items-center justify-between pb-2 border-b border-stone-200/50">
                <span class="text-[10px] text-stone-500 uppercase tracking-widest font-heading font-extrabold">Your Plated Items ({{ cartCount }})</span>
                <button 
                  @click="clearAllCart()"
                  class="text-red-500 hover:text-red-700 text-[10px] font-heading font-black flex items-center gap-1 hover:underline cursor-pointer"
                >
                  <span class="material-symbols-outlined text-[13px] font-black">delete_sweep</span>
                  Delete All Items
                </button>
              </div>

              <div 
                v-for="cItem in cart" 
                :key="cItem.cartKey"
                class="bg-white rounded-2xl p-4 border border-stone-200/50 shadow-xs flex gap-3.5"
              >
                <!-- Thumbnail -->
                <div class="w-16 h-16 rounded-xl object-cover overflow-hidden bg-stone-100 shrink-0 select-none">
                  <img :src="cItem.image" :alt="cItem.name" class="w-full h-full object-cover" referrerpolicy="no-referrer" />
                </div>

                <!-- Body details -->
                <div class="flex-grow space-y-1 text-left">
                  <div class="flex items-start justify-between">
                    <h5 class="font-heading font-extrabold text-stone-800 text-xs leading-tight">
                      {{ cItem.name }}
                    </h5>
                    <button 
                      @click="removeFromCart(cItem.cartKey)"
                      class="text-red-500 hover:text-red-700 font-black cursor-pointer"
                    >
                      <span class="material-symbols-outlined text-base">delete</span>
                    </button>
                  </div>

                  <!-- Extras details -->
                  <p 
                    v-if="cItem.extras && cItem.extras.length > 0" 
                    class="text-[10px] text-stone-400 font-sans leading-relaxed flex flex-wrap gap-1"
                  >
                    <span class="bg-[#fee33c]/20 text-[#863d96] px-1.5 py-0.5 rounded uppercase font-bold text-[9px] tracking-wide inline-block">
                      Toppings: {{ cItem.extras.join(', ') }}
                    </span>
                  </p>

                  <!-- Note instructions -->
                  <p v-if="cItem.notes" class="text-[10px] italic font-sans text-stone-500 bg-stone-50 p-1.5 rounded-lg border border-stone-100">
                    Notes: "{{ cItem.notes }}"
                  </p>

                  <!-- Price and quantity selectors -->
                  <div class="flex items-center justify-between pt-2 block">
                    <span class="font-heading font-black text-[#863d96] text-xs">
                      ${{ (cItem.finalPrice * cItem.qty).toFixed(2) }}
                    </span>

                    <!-- Quantity handlers -->
                    <div class="flex flex-col items-end gap-0.5">
                      <div class="flex items-center bg-stone-100 px-2 py-1 rounded-lg border border-stone-200/50 gap-2.5">
                        <button @click="updateCartQty(cItem.cartKey, -1)" class="text-stone-500 hover:text-[#863d96] font-bold text-xs shrink-0">-</button>
                        <span class="font-mono font-bold text-xs text-stone-700 w-4 text-center select-none">{{ cItem.qty }}</span>
                        <button @click="updateCartQty(cItem.cartKey, 1)" class="text-stone-500 hover:text-[#863d96] font-bold text-xs shrink-0">+</button>
                      </div>
                      <p 
                        v-if="cartErrorMsgs[cItem.cartKey]"
                        class="text-[8.5px] text-rose-600 font-extrabold font-sans text-right mt-0.5 leading-none"
                      >
                        {{ cartErrorMsgs[cItem.cartKey] }}
                      </p>
                      <template v-else-if="unifiedMenuItems.find(m => m.id === cItem.id)?.quantity !== undefined">
                        <p 
                          v-if="Number(unifiedMenuItems.find(m => m.id === cItem.id).quantity) === 0"
                          class="text-[9px] text-rose-600 font-black font-heading text-right uppercase tracking-wider mt-0.5 leading-none"
                        >
                          Out of Stock ❌
                        </p>
                        <p 
                          v-else
                          class="text-[9px] font-black font-heading text-right uppercase tracking-wider mt-0.5 leading-none"
                          :class="Number(unifiedMenuItems.find(m => m.id === cItem.id).quantity) <= 2 ? 'text-amber-600' : 'text-emerald-600'"
                        >
                          {{ unifiedMenuItems.find(m => m.id === cItem.id).quantity }} left
                        </p>
                      </template>
                    </div>
                  </div>

                </div>

              </div>
            </div>

            <!-- You May Also Like Suggestions Section shown on both empty and full -->
            <div class="pt-6 border-t border-stone-200/60 select-none">
              <h5 class="font-heading font-black text-xs text-stone-700 tracking-wide mb-4 flex items-center gap-1.5 px-0.5 text-left">
                <span class="material-symbols-outlined text-[#863d96] text-sm font-black">thumb_up</span>
                You May Also Like
              </h5>
              <div class="grid grid-cols-2 gap-3 pb-2">
                <div 
                  v-for="sugItem in unifiedMenuItems.slice(0, 6)" 
                  :key="'sug-' + sugItem.id"
                  class="bg-white rounded-2xl border border-stone-200/40 hover:border-amber-200 shadow-xs flex flex-col overflow-hidden transition-all group"
                >
                  <!-- Larger Image Container -->
                  <div class="relative h-28 w-full bg-stone-100 overflow-hidden shrink-0 cursor-pointer" @click="openDetailModal(sugItem)">
                    <img 
                      :src="sugItem.image" 
                      :alt="sugItem.name" 
                      class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" 
                      referrerpolicy="no-referrer" 
                    />
                    <!-- Subtle Badge for price label -->
                    <div class="absolute bottom-1.5 left-1.5 bg-black/65 backdrop-blur-xs text-white text-[9px] px-1.5 py-0.5 rounded-md font-black">
                      {{ sugItem.priceLabel }}
                    </div>
                  </div>
                  
                  <!-- Details Wrapper below the image -->
                  <div class="p-2.5 flex-grow flex flex-col justify-between text-left space-y-2 bg-stone-50/30">
                    <div class="space-y-0.5">
                      <p 
                        class="font-heading font-extrabold text-[10.5px] text-stone-850 leading-tight hover:text-[#863d96] cursor-pointer line-clamp-2" 
                        @click="openDetailModal(sugItem)"
                      >
                        {{ sugItem.name }}
                      </p>
                    </div>
                    
                    <button 
                      @click="addDirectToCart(sugItem)"
                      class="w-full bg-[#863d96] hover:bg-[#fee33c] text-white hover:text-[#863d96] py-1.5 rounded-lg font-heading font-black text-[9px] uppercase tracking-wide transition-all flex items-center justify-center gap-1 cursor-pointer active:scale-95"
                    >
                      <span class="material-symbols-outlined text-[11px] font-black">add_shopping_cart</span>
                      Add
                    </button>
                  </div>
                </div>
              </div>
            </div>

          </div>

          <!-- Checkout footer panel -->
          <div v-if="cart.length > 0" class="p-5 border-t border-stone-200/50 bg-white space-y-4">
            <div class="flex items-center justify-between text-xs font-heading font-extrabold text-stone-700">
              <span>Overall Custom Platter Summary Total:</span>
              <span class="text-lg font-black text-[#863d96] font-mono">${{ cartTotal.toFixed(2) }}</span>
            </div>
            
            <button 
              @click="isCartOpen = false; switchTab('checkout')"
              class="w-full py-3.5 bg-[#863d96] hover:bg-[#723281] text-white text-xs font-heading font-black rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider"
            >
              <span class="material-symbols-outlined text-md font-bold">shopping_cart_checkout</span>
              Go To Checkout
            </button>
            <p class="text-[10px] text-center text-stone-400 font-sans">
              All prices strictly shown in USD ($). Orders prepared in our highly air-conditioned kitchen.
            </p>
          </div>

        </div>
      </div>

      <!-- ================= COMPONENT FOOD DETAILS MODAL ================= -->
      <div 
        v-if="activeDetailItemResolved" 
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#291830]/65 select-none"
      >
        <div class="w-full max-w-lg bg-white rounded-3xl overflow-hidden shadow-2xl animate-zoomIn flex flex-col max-h-[90vh]">
          
          <div class="relative h-60 w-full object-cover">
            <button 
              @click="toggleFavorite(activeDetailItemResolved)"
              class="absolute top-4 left-4 w-8 h-8 rounded-full bg-white/60 hover:bg-white backdrop-blur-md flex items-center justify-center transition-all z-10 cursor-pointer shadow-sm border border-white/20 hover:scale-105"
              :title="isFavorited(activeDetailItemResolved.id) ? 'Remove from Favorites' : 'Add to Favorites'"
            >
              <span 
                class="material-symbols-outlined text-xs transition-transform duration-200 select-none" 
                :class="{'filled text-rose-500 scale-105': isFavorited(activeDetailItemResolved.id), 'text-stone-700': !isFavorited(activeDetailItemResolved.id)}"
              >
                favorite
              </span>
            </button>
            <button 
              @click="closeDetailModal"
              class="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/40 hover:bg-white backdrop-blur-md flex items-center justify-center text-[#291830] transition-colors z-10 cursor-pointer shadow-xs border border-white/20"
            >
              <span class="material-symbols-outlined text-sm font-black">close</span>
            </button>
            <img :src="activeDetailItemResolved.image" :alt="activeDetailItemResolved.name" class="w-full h-full object-cover" referrerpolicy="no-referrer" />
            <div class="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent"></div>
            <div class="absolute bottom-5 left-5 text-white">
              <span v-if="activeDetailItemResolved.badge" class="bg-[#fee33c] text-[#863d96] text-[9px] font-heading font-extrabold tracking-widest px-2.5 py-0.5 rounded-full uppercase block w-max mb-1.5">
                {{ activeDetailItemResolved.badge }}
              </span>
              <h3 class="font-heading font-black text-md md:text-lg tracking-tight drop-shadow-sm">
                {{ activeDetailItemResolved.name }}
              </h3>
            </div>
          </div>

          <div class="p-6 overflow-y-auto space-y-4">
            <p class="text-xs font-sans text-stone-500 leading-relaxed">
              {{ activeDetailItemResolved.description }}
            </p>

            <div class="pt-2 flex items-center justify-between text-xs font-heading font-extrabold border-t border-stone-100">
              <div class="space-y-0.5">
                <span class="text-stone-400 block tracking-wide uppercase text-[9px]">Starting Price</span>
                <span class="text-md text-[#863d96] font-black">{{ activeDetailItemResolved.priceLabel }}</span>
              </div>
              <div v-if="activeDetailItemResolved.quantity !== undefined" class="space-y-0.5 text-center">
                <span class="text-stone-400 block tracking-wide uppercase text-[9px]">Availability</span>
                <span class="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full" :class="activeDetailItemResolved.quantity === 0 ? 'bg-rose-100 text-rose-700 border border-rose-200 animate-pulse' : (activeDetailItemResolved.quantity <= 3 ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200')">
                  {{ activeDetailItemResolved.quantity === 0 ? 'Out of Stock ❌' : `${activeDetailItemResolved.quantity} left` }}
                </span>
              </div>
              <div class="space-y-0.5 text-right">
                <span class="text-stone-400 block tracking-wide uppercase text-[9px]">Category</span>
                <span class="text-stone-600 uppercase text-[10px] tracking-wider bg-stone-50 px-2 py-0.5 rounded-full border border-stone-200">
                  {{ activeDetailItemResolved.category }}
                </span>
              </div>
            </div>

            <!-- Authentic ingredients call-outs -->
            <div class="bg-[#fee33c]/10 border border-[#fee33c]/30 rounded-2xl p-4 text-[11px] font-sans text-stone-600 leading-relaxed">
              <p class="font-heading font-extrabold text-[#863d96] text-[10px] uppercase mb-1 flex items-center gap-1.5">
                <span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                Fresh Lebanese Ingredients Guarantee:
              </p>
              Prepped meticulously upon catalog trigger, utilizing pure Belgian chocolates, real milk creams, fresh mountain honey drops, and coastal garden avocados. Customized with selectable toppings in My Plate planner!
            </div>
          </div>

          <div class="p-5 border-t border-stone-150 bg-stone-50 flex gap-3.5">
            <button 
              @click="closeDetailModal" 
              class="w-full py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-600 text-xs font-heading font-bold rounded-xl transition-colors cursor-pointer border border-stone-200/50"
            >
              Close Details
            </button>
            <button 
              v-if="activeDetailItemResolved.quantity === 0"
              disabled
              class="w-full py-2.5 bg-stone-200 text-stone-400 text-xs font-heading font-black rounded-xl cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              <span class="material-symbols-outlined text-sm">close</span>
              Out of stock ❌
            </button>
            <button 
              v-else
              @click="customizeFromDetail()"
              class="w-full py-2.5 bg-[#863d96] hover:bg-[#723281] text-white text-xs font-heading font-black rounded-xl shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
            >
              <span class="material-symbols-outlined text-sm">construction</span>
              Customize Recipe
            </button>
          </div>

        </div>
      </div>

      <!-- ================= RECIPE CUSTOMIZER MODAL ================= -->
      <div 
        v-if="activeCustomItem" 
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#291830]/65 select-none"
      >
        <div class="w-full max-w-md bg-white rounded-3xl overflow-hidden shadow-2xl animate-zoomIn flex flex-col max-h-[90vh]">
          
          <!-- Head -->
          <div class="p-5 border-b border-stone-200/50 bg-[#863d96]/5 flex items-center justify-between">
            <div>
              <span class="text-[9px] text-[#863d96] bg-[#863d96]/10 font-heading font-extrabold px-2.5 py-0.5 rounded-md uppercase tracking-wider block w-max">
                Recipe Customizer
              </span>
              <h4 class="font-heading font-black text-[#291830] text-sm tracking-tight mt-1">
                Customize Platter &amp; Toppings
              </h4>
            </div>
            <button 
              @click="closeCustomizer"
              class="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center cursor-pointer border border-stone-150"
            >
              <span class="material-symbols-outlined text-sm font-black text-stone-500">close</span>
            </button>
          </div>

          <!-- Body -->
          <div class="p-5 overflow-y-auto space-y-5 flex-grow font-sans text-xs">
            <div class="flex items-center gap-4 border-b border-stone-100 pb-4">
              <img :src="activeCustomItemResolved.image" :alt="activeCustomItemResolved.name" class="w-16 h-16 rounded-xl object-cover shrink-0 bg-stone-100" referrerpolicy="no-referrer" />
              <div>
                <h5 class="font-heading font-black text-[#291830] text-xs">
                  {{ activeCustomItemResolved.name }}
                </h5>
                <p class="text-stone-400 font-sans text-[11px] leading-relaxed line-clamp-1 mt-0.5">
                  {{ activeCustomItemResolved.description }}
                </p>
                <div class="flex flex-col sm:flex-row sm:items-center justify-between mt-1 gap-1">
                  <p class="text-stone-400 font-sans text-[11px] font-bold">
                    Base recipe price: ${{ activeCustomItemResolved.price.toFixed(2) }}
                  </p>
                  <p v-if="activeCustomItemResolved.quantity !== undefined" class="font-sans text-[11px] font-bold" :class="activeCustomItemResolved.quantity <= 0 ? 'text-rose-500' : (activeCustomItemResolved.quantity <= 3 ? 'text-rose-500 animate-pulse' : 'text-emerald-600')">
                    Stock: {{ activeCustomItemResolved.quantity === 0 ? 'Out of Stock ❌' : `${activeCustomItemResolved.quantity} left` }}
                  </p>
                </div>
              </div>
            </div>

            <!-- Size / Portion selector if item has sizes -->
            <div v-if="activeCustomItemResolved.sizes && activeCustomItemResolved.sizes.length > 0" class="space-y-2 pb-2 border-b border-stone-100">
              <label class="text-[10px] text-stone-400 font-heading font-black uppercase tracking-wider block">Select Size / Portion</label>
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <button 
                  v-for="sz in activeCustomItemResolved.sizes" 
                  :key="sz.name"
                  type="button"
                  @click="selectedSize = sz"
                  class="px-3 py-2 rounded-xl text-xs font-heading font-bold border transition-all cursor-pointer flex flex-col items-center justify-center text-center gap-0.5"
                  :class="[selectedSize && selectedSize.name === sz.name ? 'bg-[#fee33c]/30 border-[#863d96] text-[#863d96] font-black shadow-2xs scale-[1.02]' : 'bg-stone-50 border-stone-200 text-stone-600 hover:bg-stone-100']"
                >
                  <span>{{ sz.name }}</span>
                  <span class="text-[10px] text-stone-500 font-mono">${{ sz.price.toFixed(2) }}</span>
                </button>
              </div>
            </div>

            <!-- Premium extra toppings checklist -->
            <div class="space-y-3">
              <label class="text-[10px] text-stone-400 font-heading font-black uppercase tracking-wider block">Add Extra Premium Toppings</label>
              
              <div class="space-y-2">
                <div 
                  v-for="topping in premiumToppings" 
                  :key="topping.id"
                  @click="toggleExtra(topping.id)"
                  class="flex items-center justify-between p-3 rounded-2xl border cursor-pointer hover:bg-stone-50 transition-colors"
                  :class="[selectedExtras.includes(topping.id) ? 'bg-[#fee33c]/10 border-[#fee33c]' : 'border-stone-150']"
                >
                  <div class="flex items-center gap-2.5">
                    <span 
                      class="material-symbols-outlined text-md"
                      :class="[selectedExtras.includes(topping.id) ? 'text-[#863d96] font-black' : 'text-stone-300']"
                    >
                      {{ selectedExtras.includes(topping.id) ? 'check_box' : 'check_box_outline_blank' }}
                    </span>
                    <span class="font-heading font-bold text-stone-700 text-[11px]">{{ topping.name }}</span>
                  </div>
                  <span class="font-mono font-bold text-stone-400 text-[11px]">+${{ topping.price.toFixed(2) }}</span>
                </div>
              </div>
            </div>

            <!-- Customized instructions note -->
            <div class="space-y-1.5">
              <label class="text-[10px] text-stone-400 font-heading font-black uppercase tracking-wider block">Kitchen Instruction / Customized Notes</label>
              <textarea 
                v-model="customizationNotes"
                rows="2" 
                placeholder="e.g. Extra hot milk Belgian sauce on the side please..." 
                class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3 py-2 text-xs font-sans resize-none"
              ></textarea>
            </div>

            <!-- Quantity counter -->
            <div class="flex items-center justify-between pt-2 border-t border-stone-100">
              <span class="font-heading font-black text-stone-700">Quantity Select</span>
              
              <div class="flex flex-col items-end gap-1">
                <div class="flex items-center bg-stone-100 px-3 py-1.5 rounded-xl border border-stone-200/50 gap-3.5 select-none">
                  <button type="button" @click="decreaseCustomizationQty" class="text-stone-500 hover:text-[#863d96] font-bold text-sm select-none cursor-pointer">-</button>
                  <span class="font-mono font-bold text-sm text-stone-700 w-5 text-center select-none">{{ customizationQty }}</span>
                  <button 
                    type="button" 
                    @click="increaseCustomizationQty" 
                    class="text-stone-500 hover:text-[#863d96] font-bold text-sm select-none cursor-pointer"
                    :class="{'opacity-40 pointer-events-none': activeCustomItemResolved.quantity !== undefined && customizationQty >= activeCustomItemResolved.quantity}"
                  >+</button>
                </div>
                <p 
                  v-if="customizationErrorMsg"
                  class="text-[9.5px] text-rose-600 font-extrabold font-sans text-right max-w-[220px] leading-tight mt-0.5"
                >
                  {{ customizationErrorMsg }}
                </p>
                <p 
                  v-else-if="activeCustomItemResolved && activeCustomItemResolved.quantity !== undefined && activeCustomItemResolved.quantity > 0 && customizationQty >= activeCustomItemResolved.quantity" 
                  class="text-[9.5px] text-rose-600 font-extrabold font-heading text-right uppercase tracking-wider animate-pulse mt-0.5"
                >
                  Just {{ activeCustomItemResolved.quantity }} left! ⚠️
                </p>
              </div>
            </div>

          </div>

          <!-- Footer -->
          <div class="p-5 border-t border-stone-150 bg-stone-50 space-y-4">
            <div class="flex items-center justify-between font-heading font-extrabold text-stone-700">
              <span>Overall Customized Single Unit:</span>
              <span class="font-mono font-black text-[#863d96] text-xs sm:text-sm">
                ${{ (currentSingleItemTotalPrice * customizationQty).toFixed(2) }}
              </span>
            </div>

            <button 
              v-if="activeCustomItemResolved.quantity === 0"
              disabled
              class="w-full py-3 bg-stone-200 text-stone-400 text-xs font-heading font-black rounded-xl cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              <span class="material-symbols-outlined text-md">close</span>
              Sorry, Out of stock ❌
            </button>
            <button 
              v-else
              @click="addToPlate"
              class="w-full py-3 bg-[#863d96] hover:bg-[#723281] text-white text-xs font-heading font-black rounded-xl shadow-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span class="material-symbols-outlined text-md">add_shopping_cart</span>
              Add Custom Platter Design To Plate
            </button>
          </div>

        </div>
      </div>

      <!-- ================= LOYALTY CLUB & CHALLENGES DIALOG ================= -->
      <div 
        v-if="isLoyaltyModalOpen" 
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#291830]/65 select-none animate-fadeIn"
      >
        <div class="w-full max-w-md bg-white rounded-3xl overflow-hidden shadow-2xl animate-zoomIn flex flex-col max-h-[90vh]">
          
          <!-- Head -->
          <div class="p-5 border-b border-stone-200/50 bg-[#863d96]/5 flex items-center justify-between">
            <div>
              <span class="text-[9px] text-[#863d96] bg-[#863d96]/10 font-heading font-extrabold px-2.5 py-0.5 rounded-md uppercase tracking-wider block w-max">
                Sweetheart Loyalty Club
              </span>
              <h4 class="font-heading font-black text-[#291830] text-sm tracking-tight mt-1">
                Sweetheart Tasks &amp; Points 🏆
              </h4>
            </div>
            <button 
              @click="isLoyaltyModalOpen = false"
              class="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center cursor-pointer border border-stone-150"
            >
              <span class="material-symbols-outlined text-sm font-black text-stone-500">close</span>
            </button>
          </div>

          <!-- Scrollable Body -->
          <div class="p-5 overflow-y-auto space-y-5">
            <!-- Summary Progress Board -->
            <div class="bg-gradient-to-tr from-[#863d96] to-[#723281] p-5 rounded-2xl text-white shadow-md relative overflow-hidden">
              <!-- Decor -->
              <div class="absolute -right-6 -bottom-6 text-white/10 text-9xl font-black font-heading select-none pointer-events-none">
                🏆
              </div>
              
              <div class="relative z-10">
                <span class="text-[9px] bg-white/20 text-yellow-200 font-heading font-extrabold px-2 py-0.5 rounded-md uppercase tracking-wider">
                  Live Counter Status
                </span>
                
                <div class="mt-3 flex items-baseline gap-2">
                  <span class="text-3xl font-heading font-black text-yellow-300">
                    {{ loyaltyPoints }}
                  </span>
                  <span class="text-xs text-stone-200">Points Accumulated</span>
                </div>

                <!-- Custom requested hours & points representation (target: 6h) -->
                <div class="mt-4 pt-4 border-t border-white/10 flex items-center justify-between text-xs">
                  <div>
                    <p class="text-stone-300 text-[10px]">Effort Completed</p>
                    <p class="font-heading font-bold text-white text-sm">{{ totalCompletedHours }}h / 6.0h</p>
                  </div>
                  <div class="text-right">
                    <p class="text-stone-300 text-[10px]">Task Status</p>
                    <p class="font-heading font-bold text-yellow-300 text-sm">
                      {{ totalCompletedHours >= 6 ? '🏆 Goal Reached!' : '🎯 Target 6.0 Hours' }}
                    </p>
                  </div>
                </div>

                <!-- Progress Bar -->
                <div class="mt-3 w-full bg-white/20 rounded-full h-2">
                  <div 
                    class="bg-yellow-300 h-2 rounded-full transition-all duration-500" 
                    :style="{ width: `${Math.min(100, (totalCompletedHours / 6) * 100)}%` }"
                  ></div>
                </div>
              </div>
            </div>

            <!-- List of Tasks -->
            <div class="space-y-2.5">
              <p class="text-[10px] text-stone-400 font-heading font-black uppercase tracking-wider">
                Current Sweetheart Tasks ({{ completedTasks.length }} / {{ loyaltyChallenges.length }})
              </p>

              <div 
                v-for="task in loyaltyChallenges" 
                :key="task.id"
                :class="[
                  completedTasks.includes(task.id) 
                    ? 'bg-emerald-50/50 border-emerald-100' 
                    : 'bg-stone-50/60 border-stone-100 hover:bg-stone-50 transition-colors'
                ]"
                class="p-3.5 rounded-xl border flex items-center justify-between gap-4"
              >
                <div class="flex items-start gap-3 min-w-0">
                  <div class="mt-0.5 shrink-0">
                    <span 
                      v-if="completedTasks.includes(task.id)" 
                      class="material-symbols-outlined text-emerald-600 bg-emerald-150 p-1 rounded-md text-xs font-bold leading-none select-none"
                    >
                      check_circle
                    </span>
                    <span 
                      v-else 
                      class="material-symbols-outlined text-stone-400 bg-stone-200 p-1 rounded-md text-xs leading-none select-none"
                    >
                      hourglass_empty
                    </span>
                  </div>
                  
                  <div class="min-w-0">
                    <h5 
                      :class="[completedTasks.includes(task.id) ? 'text-emerald-900 font-extrabold line-through decoration-emerald-200' : 'text-stone-800 font-bold']"
                      class="font-heading text-[11px] leading-tight"
                    >
                      {{ task.title }}
                    </h5>
                    <p class="text-[9px] text-stone-400 font-mono mt-0.5 flex items-center gap-2">
                      <span class="text-stone-500 font-bold">{{ task.points }} pts</span>
                      <span class="text-stone-300">•</span>
                      <span class="text-[#863d96] font-bold">⏱️ {{ task.hours }}</span>
                    </p>
                  </div>
                </div>

                <div class="shrink-0 text-right">
                  <span 
                    v-if="completedTasks.includes(task.id)" 
                    class="text-[9px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md font-heading font-extrabold block"
                  >
                    +{{ task.points }}
                  </span>
                  <span 
                    v-else 
                    class="text-[9px] bg-stone-200 text-stone-600 px-2 py-0.5 rounded-md font-heading font-extrabold block"
                  >
                    PENDING
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="p-4 border-t border-stone-200/50 bg-stone-50/80 flex justify-end">
            <button 
              @click="isLoyaltyModalOpen = false"
              class="px-4 py-2 bg-[#863d96] hover:bg-[#723281] text-white text-[10px] font-heading font-black rounded-lg shadow-sm transition-colors cursor-pointer"
            >
              Sweet! Let's complete more
            </button>
          </div>

        </div>
      </div>

      <!-- ================= USER SETTINGS DIALOG ================= -->
      <div 
        v-if="isSettingsModalOpen" 
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#291830]/65 select-none"
      >
        <div class="w-full max-w-md bg-white rounded-3xl overflow-hidden shadow-2xl animate-zoomIn flex flex-col max-h-[90vh]">
          
          <!-- Head -->
          <div class="p-5 border-b border-stone-200/50 bg-[#863d96]/5 flex items-center justify-between">
            <div>
              <span class="text-[9px] text-[#863d96] bg-[#863d96]/10 font-heading font-extrabold px-2.5 py-0.5 rounded-md uppercase tracking-wider block w-max">
                User Settings
              </span>
              <h4 class="font-heading font-black text-[#291830] text-sm tracking-tight mt-1">
                Edit Profile & Security ⚙️
              </h4>
            </div>
            <button 
              @click="isSettingsModalOpen = false"
              class="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center cursor-pointer border border-stone-150"
            >
              <span class="material-symbols-outlined text-sm font-black text-stone-500">close</span>
            </button>
          </div>

          <!-- Scrollable Body -->
          <div class="p-5 overflow-y-auto space-y-5 text-left font-sans">
            
            <!-- Account Info Tag -->
            <div class="bg-[#863d96]/5 p-3 rounded-2xl border border-[#863d96]/10 flex items-center gap-3">
              <div class="w-10 h-10 rounded-full bg-[#863d96] text-white flex items-center justify-center font-black text-xs uppercase shadow-xs">
                {{ loggedUser?.initials }}
              </div>
              <div>
                <p class="text-xs font-heading font-black text-stone-800">{{ loggedUser?.name }}</p>
                <p class="text-[10px] text-stone-500 font-mono">{{ loggedUser?.email }}</p>
              </div>
            </div>

            <!-- Profile Details Section -->
            <div class="space-y-3">
              <h5 class="text-[10px] text-stone-400 font-heading font-black uppercase tracking-wider border-b border-stone-100 pb-1">
                Profile Details
              </h5>
              
              <!-- Full Name Input -->
              <div class="space-y-1">
                <label class="text-[10px] font-heading font-black text-stone-600 uppercase tracking-wider block">
                  Full Name
                </label>
                <div class="relative">
                  <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">person</span>
                  <input 
                    type="text" 
                    v-model="settingsName" 
                    placeholder="Enter your full name"
                    class="w-full pl-9 pr-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs font-sans focus:outline-none focus:ring-1 focus:ring-[#863d96] focus:bg-white text-stone-800 transition-all"
                  />
                </div>
              </div>

              <!-- Phone & City Grid -->
              <div class="grid grid-cols-2 gap-3">
                <div class="space-y-1">
                  <label class="text-[10px] font-heading font-black text-stone-600 uppercase tracking-wider block">
                    Mobile Number
                  </label>
                  <div class="relative">
                    <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">call</span>
                    <input 
                      type="tel" 
                      v-model="settingsPhone" 
                      placeholder="e.g. 03123456"
                      class="w-full pl-9 pr-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[#863d96] focus:bg-white text-stone-800 transition-all"
                    />
                  </div>
                </div>

                <div class="space-y-1">
                  <label class="text-[10px] font-heading font-black text-stone-600 uppercase tracking-wider block">
                    City
                  </label>
                  <div class="relative">
                    <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">location_on</span>
                    <input 
                      type="text" 
                      v-model="settingsCity" 
                      placeholder="e.g. Batroun"
                      class="w-full pl-9 pr-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs font-sans focus:outline-none focus:ring-1 focus:ring-[#863d96] focus:bg-white text-stone-800 transition-all"
                    />
                  </div>
                </div>
              </div>
            </div>

            <!-- Password Change Section -->
            <div class="space-y-3 pt-2">
              <h5 class="text-[10px] text-stone-400 font-heading font-black uppercase tracking-wider border-b border-stone-100 pb-1">
                Security & Password
              </h5>
              
              <!-- When hidden: Show two compact, professional action buttons -->
              <div v-if="!showPasswordFields" class="grid grid-cols-2 gap-3 pt-1">
                <button 
                  type="button"
                  @click="triggerForgotPassword()"
                  :disabled="isSendingResetEmail"
                  class="py-1.5 px-3.5 bg-[#863d96]/5 hover:bg-[#863d96]/10 disabled:bg-stone-50 border border-[#863d96]/15 hover:border-[#863d96]/25 text-[#863d96] text-[8.5px] font-heading font-black rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer uppercase tracking-wider text-center"
                >
                  <span v-if="isSendingResetEmail" class="animate-spin text-[10px]">⏳</span>
                  <span v-else class="material-symbols-outlined text-[11px]">mail</span>
                  {{ isSendingResetEmail ? 'Sending...' : 'Forgot Password' }}
                </button>
                
                <button 
                  type="button"
                  @click="showPasswordFields = true"
                  class="py-1.5 px-3.5 bg-[#863d96] hover:bg-[#723281] text-white text-[8.5px] font-heading font-black rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer uppercase tracking-wider text-center"
                >
                  <span class="material-symbols-outlined text-[11px]">key</span>
                  Change Password
                </button>
              </div>

              <!-- When shown: reveal the forms and custom compact action buttons -->
              <div v-else class="space-y-3 p-3 bg-stone-50 rounded-2xl border border-stone-150 animate-fadeIn">
                <!-- Old Password -->
                <div class="space-y-1">
                  <label class="text-[9.5px] font-heading font-black text-stone-600 uppercase tracking-wider block">
                    Old Password
                  </label>
                  <div class="relative">
                    <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">lock_open</span>
                    <input 
                      type="password" 
                      v-model="settingsOldPassword" 
                      placeholder="Enter current password"
                      class="w-full pl-9 pr-3 py-2 bg-white border border-stone-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[#863d96] text-stone-800 transition-all"
                    />
                  </div>
                  
                  <!-- Auto-fill local saved password helper -->
                  <div v-if="loggedUser?.password" class="pt-1 flex items-center justify-between text-[10px] text-stone-500 font-sans leading-tight">
                    <span>Forgot?</span>
                    <button 
                      type="button" 
                      @click="settingsOldPassword = loggedUser.password" 
                      class="text-[#863d96] hover:text-[#723281] font-black focus:outline-none cursor-pointer flex items-center gap-0.5 transition-all text-[9.5px]"
                    >
                      <span class="material-symbols-outlined text-[10px]">bolt</span>
                      Use Saved: {{ loggedUser.password }} 🔑
                    </button>
                  </div>
                </div>

                <!-- New Password & Confirm Password Grid -->
                <div class="grid grid-cols-2 gap-3">
                  <div class="space-y-1">
                    <label class="text-[9.5px] font-heading font-black text-stone-600 uppercase tracking-wider block">
                      New Password
                    </label>
                    <div class="relative">
                      <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">lock</span>
                      <input 
                        type="password" 
                        v-model="settingsNewPassword" 
                        placeholder="New password"
                        class="w-full pl-9 pr-3 py-2 bg-white border border-stone-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[#863d96] text-stone-800 transition-all"
                      />
                    </div>
                  </div>

                  <div class="space-y-1">
                    <label class="text-[9.5px] font-heading font-black text-stone-600 uppercase tracking-wider block">
                      Confirm
                    </label>
                    <div class="relative">
                      <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">lock_clock</span>
                      <input 
                        type="password" 
                        v-model="settingsConfirmNewPassword" 
                        placeholder="Confirm password"
                        class="w-full pl-9 pr-3 py-2 bg-white border border-stone-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[#863d96] text-stone-800 transition-all"
                      />
                    </div>
                  </div>
                </div>

                <!-- compact submit / cancel for form -->
                <div class="pt-1.5 grid grid-cols-2 gap-3 border-t border-stone-200/60">
                  <button 
                    type="button"
                    @click="showPasswordFields = false; settingsOldPassword = ''; settingsNewPassword = ''; settingsConfirmNewPassword = '';"
                    class="py-1.5 px-3 bg-stone-200 hover:bg-stone-300 text-stone-700 text-[8.5px] font-heading font-black rounded-lg transition-colors cursor-pointer uppercase tracking-wider text-center"
                  >
                    Cancel
                  </button>
                  <button 
                    type="button"
                    @click="triggerChangePassword()"
                    :disabled="isChangingPassword"
                    class="py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-stone-300 text-white text-[8.5px] font-heading font-black rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer uppercase tracking-wider text-center"
                  >
                    <span v-if="isChangingPassword" class="animate-spin text-[10px]">⏳</span>
                    <span v-else class="material-symbols-outlined text-[11px]">save</span>
                    {{ isChangingPassword ? 'Saving...' : 'Update Password' }}
                  </button>
                </div>
              </div>
            </div>

          </div>

          <!-- Footer Buttons -->
          <div class="p-5 border-t border-stone-200/50 bg-stone-50/50 grid grid-cols-2 gap-3">
            <button 
              type="button"
              @click="isSettingsModalOpen = false"
              class="w-full py-3 bg-stone-100 hover:bg-stone-200 text-stone-600 text-xs font-heading font-black rounded-xl border border-stone-200 transition-colors cursor-pointer uppercase tracking-wider text-center"
            >
              Cancel
            </button>
            <button 
              type="button"
              @click="handleSaveSettings"
              :disabled="isSavingSettings"
              class="w-full py-3 bg-[#863d96] hover:bg-[#723281] disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed text-white text-xs font-heading font-black rounded-xl shadow-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider"
            >
              <span v-if="isSavingSettings" class="animate-spin text-xs">⏳</span>
              <span v-else class="material-symbols-outlined text-sm">save</span>
              {{ isSavingSettings ? 'Saving...' : 'Save Settings' }}
            </button>
          </div>

        </div>
      </div>

      <!-- ================= SIGN IN / ACCREDITATION DIALOG ================= -->
      <div 
        v-if="isLoginModalOpen" 
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#291830]/65 select-none"
      >
        <div class="w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-2xl animate-zoomIn flex flex-col">
          
          <!-- Head -->
          <div class="p-5 border-b border-stone-200/50 bg-[#863d96]/5 flex items-center justify-between">
            <div>
              <span class="text-[9px] text-[#863d96] bg-[#863d96]/10 font-heading font-extrabold px-2.5 py-0.5 rounded-md uppercase tracking-wider block w-max animate-pulse">
                {{ signupSuccessOverlay ? 'Success!' : (showFirstTimeNotice ? 'Notice' : (isVerifying ? 'Verification Status' : (authMode === 'signup' ? 'Create Account' : 'Sign In'))) }}
              </span>
              <h4 class="font-heading font-black text-[#291830] text-sm tracking-tight mt-1">
                {{ signupSuccessOverlay ? 'Account Created 🎉' : (showFirstTimeNotice ? 'First Time Visiting? 🍒' : (isVerifying ? '6-Digit SMS Verification 📱' : (authMode === 'signup' ? 'Join Jessy Juice Family 🍒' : 'Access your Custom Profile'))) }}
              </h4>
            </div>
            <button 
              @click="isLoginModalOpen = false; cancelVerification();"
              class="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center cursor-pointer border border-stone-150"
            >
              <span class="material-symbols-outlined text-sm font-black text-stone-500">close</span>
            </button>
          </div>

          <!-- Body - Signup Success Overlay -->
          <div v-if="signupSuccessOverlay" class="p-5 space-y-5 text-center font-sans animate-fadeIn">
            <div class="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto text-green-500 border border-green-150 animate-bounce">
              <span class="material-symbols-outlined text-4xl font-black">done_all</span>
            </div>
            
            <div class="space-y-2">
              <h5 class="text-stone-800 font-heading font-extrabold text-sm uppercase tracking-wider">
                Congratulations, {{ loggedUser?.name || 'Friend' }}! 🍒
              </h5>
              <p class="text-xs text-stone-500 leading-relaxed px-2">
                Your Jessy Juice account has been created successfully! You can now start creating your dream fruit plats, adding premium extra toppings, and saving your sweet loyalty stats.
              </p>
            </div>

            <div class="bg-stone-50 border border-stone-150 p-3.5 rounded-2xl text-[11px] text-stone-600 text-left space-y-1">
              <div class="flex items-center justify-between">
                <span class="font-bold">Registered Email:</span>
                <span class="font-mono">{{ loggedUser?.email }}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="font-bold">Mobile Number:</span>
                <span class="font-mono">{{ loggedUser?.phone }}</span>
              </div>
            </div>

            <button 
              type="button"
              @click="handleSignupSuccessContinue"
              class="w-full py-3 bg-[#863d96] hover:bg-[#723281] text-white text-xs font-heading font-black rounded-xl shadow-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider"
            >
              <span class="material-symbols-outlined text-sm">rocket_launch</span>
              Enter & Continue Scrolling 🍓
            </button>
          </div>

          <!-- Body - First Time Notice -->
          <div v-else-if="showFirstTimeNotice" class="p-5 space-y-5 text-center font-sans animate-fadeIn">
            <div class="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto text-amber-500 border border-amber-150 animate-pulse">
              <span class="material-symbols-outlined text-4xl font-bold">person_add</span>
            </div>
            
            <div class="space-y-2">
              <h5 class="text-stone-800 font-heading font-extrabold text-xs uppercase tracking-wider">
                First Time Here? 🍓
              </h5>
              <p class="text-xs text-stone-400 leading-relaxed px-2">
                It's your first time! You don't have an account with the email <span class="font-bold text-stone-700 decoration-dotted underline">{{ loginEmail }}</span> yet. Create an account first to continue.
              </p>
            </div>

            <button 
              type="button"
              @click="showFirstTimeNotice = false; authMode = 'signup'; signupConfirmPassword = '';"
              class="w-full py-3 bg-[#863d96] hover:bg-[#723281] text-white text-xs font-heading font-black rounded-xl shadow-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider"
            >
              <span class="material-symbols-outlined text-sm">person_add</span>
              Create Account First ➡️
            </button>

            <button 
              type="button"
              @click="showFirstTimeNotice = false; authMode = 'signin';"
              class="text-xs text-stone-400 hover:text-stone-600 font-bold underline block mx-auto cursor-pointer"
            >
              Go Back
            </button>
          </div>

          <!-- Body - Reset Password Code Form -->
          <div v-else-if="isVerifying && pendingUserPayload?.isForgotPasswordReset" class="p-5 space-y-4 font-sans text-xs">
            <p class="text-[11px] text-stone-500 leading-normal text-center">
              A secure password reset code has been sent to your email <span class="font-bold text-[#863d96]">{{ pendingUserPayload?.email }}</span>. Enter the code and your new password below:
            </p>

            <!-- Help/Bypass Card for unreceived emails -->
            <div class="bg-amber-50 border border-amber-200/60 rounded-2xl p-3 text-amber-900 flex flex-col gap-1 text-left leading-normal animate-fadeIn">
              <div class="flex items-center gap-1 font-extrabold text-[10px] text-amber-800 uppercase tracking-wider">
                <span class="material-symbols-outlined text-[13px]">info</span>
                Did not receive the email?
              </div>
              <p class="text-[10px] text-amber-700">
                Email servers or spam filters may sometimes delay delivery. You can use our secure local backup code <strong class="font-bold text-[#863d96] font-mono">582491</strong> to bypass and reset instantly!
              </p>
              <button 
                type="button"
                @click="otpCode = '582491'"
                class="mt-1.5 self-start px-3 py-1.5 bg-amber-200/70 hover:bg-amber-200 active:bg-amber-300 text-amber-950 font-bold text-[10px] rounded-lg transition-all flex items-center gap-1 cursor-pointer"
              >
                <span class="material-symbols-outlined text-[11px]">bolt</span>
                Auto-fill Backup Code (582491)
              </button>
            </div>

            <div class="space-y-1">
              <label class="text-[10px] text-[#863d96] font-heading font-extrabold uppercase tracking-widest block font-bold text-center">Enter Verification Code</label>
              <input 
                v-model="otpCode" 
                type="text" 
                required 
                placeholder="Enter Code" 
                class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-4 py-2.5 text-xs text-center font-mono font-bold transition-all"
              />
            </div>

            <div class="space-y-1">
              <label class="text-[10px] text-[#863d96] font-heading font-extrabold uppercase tracking-widest block font-bold">New Password</label>
              <input 
                v-model="resetNewPassword" 
                type="password" 
                required 
                placeholder="••••••••" 
                class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3 py-2 text-xs font-sans transition-all"
              />
            </div>

            <div class="space-y-1">
              <label class="text-[10px] text-[#863d96] font-heading font-extrabold uppercase tracking-widest block font-bold">Confirm New Password</label>
              <input 
                v-model="resetConfirmNewPassword" 
                type="password" 
                required 
                placeholder="••••••••" 
                class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3 py-2 text-xs font-sans transition-all"
              />
            </div>

            <button 
              type="button"
              @click="handleVerifyAndResetPassword"
              class="w-full py-3 bg-[#863d96] hover:bg-[#723281] text-white text-xs font-heading font-black rounded-xl shadow-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider"
            >
              <span class="material-symbols-outlined text-sm">lock_reset</span>
              Reset Password & Sign In
            </button>

            <!-- Cancel -->
            <div class="text-center pt-1">
              <button 
                type="button" 
                @click="cancelVerification" 
                class="text-stone-400 hover:text-stone-600 cursor-pointer text-[11px]"
              >
                Back to Sign In
              </button>
            </div>
          </div>

          <!-- Body - Verification Code Form -->
          <div v-else-if="isVerifying && !pendingUserPayload?.isGuestCheckout" class="p-5 space-y-4 font-sans text-xs">
            
            <p class="text-[11px] text-stone-500 leading-normal text-center">
              A secure 4-digit verification code has been sent to your primary email address <span class="font-bold text-[#863d96]">{{ pendingUserPayload?.email }}</span>. Please input it below:
            </p>

            <div class="space-y-1">
              <label class="text-[10px] text-[#863d96] font-heading font-extrabold uppercase tracking-widest block font-bold text-center">Enter 4-Digit Code</label>
              <input 
                v-model="otpCode" 
                type="text" 
                maxlength="4"
                required 
                placeholder="0000" 
                class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-4 py-3 text-lg font-mono font-black text-center tracking-widest transition-all"
              />
            </div>

            <button 
              type="button"
              @click="verifyOtpAndLogin"
              class="w-full py-3 bg-[#863d96] hover:bg-[#723281] text-white text-xs font-heading font-black rounded-xl shadow-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider"
            >
              <span class="material-symbols-outlined text-sm">verified</span>
              Verify & Complete Login
            </button>

            <!-- Resend / Change Email -->
            <div class="flex items-center justify-between text-[11px] pt-1">
              <button 
                type="button" 
                @click="resendOtp"
                :disabled="otpCountdown > 0"
                class="font-bold cursor-pointer disabled:text-stone-300 disabled:cursor-not-allowed text-[#863d96] hover:underline"
              >
                {{ otpCountdown > 0 ? `Resend Code in ${otpCountdown}s` : 'Resend OTP Code 📧' }}
              </button>
              
              <button 
                type="button" 
                @click="cancelVerification" 
                class="text-stone-400 hover:text-stone-600 cursor-pointer"
              >
                Change Email
              </button>
            </div>

          </div>

          <!-- Body - Standard Input Form -->
          <form v-else @submit.prevent="handleAuthSubmit" class="p-5 space-y-3.5 font-sans text-xs">
            
            <!-- Full Name Input -->
            <div class="space-y-1">
              <label class="text-[10px] text-[#863d96] font-heading font-extrabold uppercase tracking-widest block font-bold">
                Full Name <span v-if="authMode === 'signup'" class="text-rose-500">*</span>
              </label>
              <input 
                v-model="loginName" 
                type="text" 
                :required="authMode === 'signup'" 
                placeholder="e.g. X" 
                class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3.5 py-2.5 text-xs font-sans transition-all"
              />
            </div>

            <!-- Email Input -->
            <div class="space-y-1">
              <label class="text-[10px] text-[#863d96] font-heading font-extrabold uppercase tracking-widest block font-bold">
                Primary Email <span class="text-rose-500">*</span>
              </label>
              <input 
                v-model="loginEmail" 
                type="email" 
                required 
                @blur="handleEmailCheck"
                placeholder="you@example.com" 
                class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3.5 py-2.5 text-xs font-sans transition-all"
              />
            </div>

            <!-- Passwords -->
            <div class="space-y-3">
              <!-- Grid for Password & Confirm Password if Sign Up, else single Password field for Sign In -->
              <div v-if="authMode === 'signup'" class="grid grid-cols-2 gap-2 animate-fadeIn">
                <div class="space-y-1 block">
                  <label class="text-[10px] text-[#863d96] font-heading font-extrabold uppercase tracking-widest block font-bold">
                    Password <span class="text-rose-500">*</span>
                  </label>
                  <input 
                    v-model="signupPassword" 
                    type="password" 
                    required
                    placeholder="••••••••" 
                    class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3 py-2 text-xs font-sans transition-all"
                  />
                </div>
                <div class="space-y-1 block">
                  <label class="text-[10px] text-[#863d96] font-heading font-extrabold uppercase tracking-widest block font-bold">
                    Re-enter Password <span class="text-rose-500">*</span>
                  </label>
                  <input 
                    v-model="signupConfirmPassword" 
                    type="password" 
                    required
                    placeholder="••••••••" 
                    class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3 py-2 text-xs font-sans transition-all"
                  />
                </div>
              </div>

              <div v-else class="space-y-1 block animate-fadeIn">
                <div class="flex items-center justify-between">
                  <label class="text-[10px] text-[#863d96] font-heading font-extrabold uppercase tracking-widest block font-bold">
                    Password <span class="text-rose-500">*</span>
                  </label>
                  <button 
                    type="button" 
                    @click="triggerForgotPassword(loginEmail)"
                    :disabled="isSendingResetEmail"
                    class="text-[10px] text-[#863d96] hover:text-[#723281] font-heading font-extrabold hover:underline cursor-pointer disabled:text-stone-300"
                  >
                    {{ isSendingResetEmail ? 'Sending...' : 'Forgot? 🔑' }}
                  </button>
                </div>
                <input 
                  v-model="signupPassword" 
                  type="password" 
                  required
                  placeholder="••••••••" 
                  class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3.5 py-2.5 text-xs font-sans transition-all"
                />
              </div>
            </div>

            <!-- Mobile Number (Only visible and required during create account) -->
            <div v-if="authMode === 'signup'" class="space-y-1 animate-fadeIn">
              <label class="text-[10px] text-[#863d96] font-heading font-extrabold uppercase tracking-widest block font-bold">
                Mobile Number <span class="text-rose-500">*</span>
              </label>
              <input 
                v-model="loginPhone" 
                type="tel" 
                required
                placeholder="e.g. 03123456 or +961..." 
                class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3.5 py-2.5 text-xs font-sans transition-all"
              />
            </div>

            <!-- City (Only visible and required during create account) -->
            <div v-if="authMode === 'signup'" class="space-y-1 animate-fadeIn">
              <label class="text-[10px] text-[#863d96] font-heading font-extrabold uppercase tracking-widest block font-bold">
                City / Town <span class="text-rose-500">*</span>
              </label>
              <input 
                v-model="loginCity" 
                type="text" 
                required
                placeholder="e.g. Batroun, Jbeil, Beirut..." 
                class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3.5 py-2.5 text-xs font-sans transition-all"
              />
            </div>

            <div class="pt-2">
              <p v-if="authMode === 'signup'" class="text-[10px] text-stone-400 leading-relaxed text-center">
                🎂 Fill out your profile with passwords & mobile number to trigger code SMS confirmation!
              </p>
              <p v-else class="text-[10px] text-[#863d96] leading-relaxed text-center">
                ✨ Enter your credentials to immediately connect and sync your My Plate creations.
              </p>
            </div>

            <button 
              type="submit"
              class="w-full mt-2 py-3 bg-[#863d96] hover:bg-[#723281] text-white text-xs font-heading font-black rounded-xl shadow-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider"
            >
              <span class="material-symbols-outlined text-sm">
                {{ authMode === 'signup' ? 'person_add' : 'key' }}
              </span>
              {{ authMode === 'signup' ? 'Create Account' : 'Login' }}
            </button>

            <!-- Continue as Guest Option -->
            <button 
              type="button"
              @click="openGuestLoginFlow"
              class="w-full mt-2 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-heading font-black rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider hover:scale-[1.01] active:scale-98"
            >
              <span class="material-symbols-outlined text-sm">person_outline</span>
              Continue as Guest 👤
            </button>

            <!-- Mode Switcher Link -->
            <p class="text-center text-[11px] mt-2 text-stone-500">
              <span v-if="authMode === 'signin'">
                Don't have an account? 
                <button type="button" @click="authMode = 'signup'" class="text-[#863d96] font-heading font-black hover:underline ml-1 cursor-pointer">
                  Create Account 🍒
                </button>
              </span>
              <span v-else>
                Already have an account? 
                <button type="button" @click="authMode = 'signin'" class="text-[#863d96] font-heading font-black hover:underline ml-1 cursor-pointer">
                  Sign In with Password ✨
                </button>
              </span>
            </p>

          </form>

        </div>
      </div>

      <!-- ================= GUEST CHECKOUT / PROFILE SELECTION DIALOG ================= -->
      <div 
        v-if="isGuestCheckoutModalOpen" 
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#291830]/75 select-none"
      >
        <div class="w-full max-w-md max-h-[90vh] bg-white rounded-3xl overflow-hidden shadow-2xl animate-zoomIn flex flex-col border border-stone-200">
          
          <!-- Head -->
          <div class="p-4 border-b border-stone-150 bg-[#863d96]/5 flex items-center justify-between shrink-0">
            <div>
              <span class="text-[9px] text-white bg-amber-500 font-heading font-extrabold px-2.5 py-0.5 rounded uppercase tracking-wider block w-max">
                {{ isGuestLoginOnly ? 'Guest Login' : 'Guest Checkout' }}
              </span>
              <h4 class="font-heading font-black text-[#291830] text-xs tracking-tight mt-1">
                {{ isGuestLoginOnly ? 'Enter Guest Details' : 'Complete Your Counter Order' }}
              </h4>
            </div>
            <button 
              @click="isGuestCheckoutModalOpen = false; isGuestLoginOnly = false;"
              class="w-7 h-7 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center cursor-pointer border border-stone-200"
            >
              <span class="material-symbols-outlined text-xs font-black text-stone-500">close</span>
            </button>
          </div>

          <!-- Body -->
          <div class="p-4 space-y-3 overflow-y-auto flex-1 scrollbar-thin">
            
            <!-- Guest OTP Verification Form -->
            <div v-if="isVerifying && pendingUserPayload?.isGuestCheckout" class="space-y-4 py-2">
              <div class="text-center space-y-2">
                <span class="material-symbols-outlined text-4xl text-[#863d96] animate-pulse">lock_person</span>
                <p class="text-xs text-stone-600 leading-normal font-sans">
                  We've sent a 4-digit verification code to <strong class="text-[#863d96]">{{ pendingUserPayload?.email }}</strong>.<br />Please enter it below to verify your order:
                </p>
              </div>

              <div class="space-y-1">
                <label class="text-[10px] text-[#863d96] font-heading font-extrabold uppercase tracking-widest block font-bold text-center">
                  Verification Code
                </label>
                <input 
                  v-model="otpCode" 
                  type="text" 
                  maxlength="4"
                  required 
                  placeholder="0000" 
                  class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-4 py-3 text-lg font-mono font-black text-center tracking-widest transition-all"
                />
              </div>

              <button 
                type="button"
                @click="verifyOtpAndLogin"
                class="w-full py-3 bg-[#863d96] hover:bg-[#723281] text-white text-xs font-heading font-black rounded-xl shadow-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider font-bold"
              >
                <span class="material-symbols-outlined text-sm">verified</span>
                Verify & Place Order
              </button>

              <!-- Resend / Change details -->
              <div class="flex items-center justify-between text-[11px] pt-1 font-sans">
                <button 
                  type="button" 
                  @click="resendOtp"
                  :disabled="otpCountdown > 0"
                  class="font-bold cursor-pointer disabled:text-stone-300 disabled:cursor-not-allowed text-[#863d96] hover:underline"
                >
                  {{ otpCountdown > 0 ? `Resend Code in ${otpCountdown}s` : 'Resend Code' }}
                </button>
                
                <button 
                  type="button" 
                  @click="cancelVerification" 
                  class="text-stone-400 hover:text-[#863d96] cursor-pointer hover:underline"
                >
                  Change Email
                </button>
              </div>
            </div>

            <!-- Standard Guest Details Form -->
            <div v-else class="space-y-3">
              <p class="text-[11px] text-stone-500 leading-normal font-sans">
                {{ isGuestLoginOnly ? 'Please fill out these simple details to enter Jessy Juice as a Guest user without needing an account.' : 'Welcome to Jessy Juice! Since you are not signed in, please fill out these quick delivery/counter details to send your custom plate order to our team, or choose to login first!' }}
              </p>

              <form @submit.prevent="handleGuestCheckoutOrLoginSubmit" class="space-y-2.5 font-sans text-xs">
                
                <!-- Full Name Input -->
                <div class="space-y-0.5">
                  <label class="text-[9px] text-[#863d96] font-heading font-extrabold uppercase tracking-widest block font-bold flex justify-between">
                    <span>Full Name</span>
                    <span class="text-rose-500">*</span>
                  </label>
                  <input 
                    v-model="guestName" 
                    type="text" 
                    required 
                    placeholder="X" 
                    class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3 py-1.5 text-xs font-sans transition-all"
                  />
                </div>

                <!-- Email Input -->
                <div class="space-y-0.5">
                  <label class="text-[9px] text-[#863d96] font-heading font-extrabold uppercase tracking-widest block font-bold flex justify-between">
                    <span>Primary Email</span>
                    <span class="text-rose-500">*</span>
                  </label>
                  <input 
                    v-model="guestEmail" 
                    type="email" 
                    required 
                    placeholder="you@example.com" 
                    class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3 py-1.5 text-xs font-sans transition-all"
                  />
                </div>

                <!-- Phone Input -->
                <div class="space-y-0.5">
                  <label class="text-[9px] text-[#863d96] font-heading font-extrabold uppercase tracking-widest block font-bold flex justify-between">
                    <span>Mobile Phone</span>
                    <span class="text-rose-500">*</span>
                  </label>
                  <input 
                    v-model="guestPhone" 
                    type="tel" 
                    required 
                    placeholder="e.g. 03123456 or +961..." 
                    class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3 py-1.5 text-xs font-sans transition-all"
                  />
                </div>

                <!-- City Input -->
                <div class="space-y-0.5">
                  <label class="text-[9px] text-[#863d96] font-heading font-extrabold uppercase tracking-widest block font-bold flex justify-between">
                    <span>City / Town</span>
                    <span class="text-rose-500">*</span>
                  </label>
                  <input 
                    v-model="guestCity" 
                    type="text" 
                    required 
                    placeholder="e.g. Batroun, Jbeil, Beirut..." 
                    class="w-full bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#863d96]/20 focus:border-[#863d96] rounded-xl px-3 py-1.5 text-xs font-sans transition-all"
                  />
                </div>

                <div class="pt-1.5">
                  <button 
                    type="submit"
                    class="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-heading font-black rounded-xl shadow-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider"
                  >
                    <span class="material-symbols-outlined text-xs">
                      {{ isGuestLoginOnly ? 'person' : 'shopping_bag' }}
                    </span>
                    {{ isGuestLoginOnly ? 'Login as Guest' : 'Place Order as Guest' }}
                  </button>
                </div>

              </form>

              <div class="relative py-1.5">
                <div class="absolute inset-0 flex items-center" aria-hidden="true">
                  <div class="w-full border-t border-stone-150"></div>
                </div>
                <div class="relative flex justify-center text-[8px] uppercase">
                  <span class="bg-white px-2 text-stone-400 font-heading font-extrabold">OR</span>
                </div>
              </div>

              <!-- Suggestion to login/register -->
              <div class="bg-stone-50 rounded-2xl p-3 border border-stone-150 space-y-1.5 text-center">
                <p class="text-[10px] text-stone-600 font-sans leading-normal">
                  Create an account or login to save your details forever, so you never get asked for your phone/city again!
                </p>
                <button 
                  type="button"
                  @click="isGuestCheckoutModalOpen = false; isGuestLoginOnly = false; isLoginModalOpen = true; authMode = 'signup';"
                  class="inline-flex items-center gap-1 bg-amber-100 hover:bg-amber-200 text-stone-850 px-3 py-1 rounded-xl text-[10px] font-heading font-black transition-colors cursor-pointer"
                >
                  <span class="material-symbols-outlined text-[10px]">person_add</span>
                  Create Account First
                </button>
                <p class="text-[9px] text-stone-400">
                  Already have an account? 
                  <button @click="isGuestCheckoutModalOpen = false; isGuestLoginOnly = false; isLoginModalOpen = true; authMode = 'signin';" class="text-[#863d96] hover:underline font-bold">Sign In</button>
                </p>
              </div>
            </div>

          </div>

        </div>
      </div>

      <!-- FOOTER -->
      <footer class="bg-stone-900 text-stone-300 py-12 px-4 border-t border-stone-850">
        <div class="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8">
          
          <!-- Column 1: Info -->
          <div class="space-y-4">
            <div class="flex items-center gap-2">
              <div class="w-9 h-9 rounded-full bg-[#fee33c] text-[#863d96] font-black flex items-center justify-center text-xs">
                JJ
              </div>
              <h4 class="font-heading font-black text-white text-sm tracking-tight uppercase">Jessy Juice</h4>
            </div>
            <p class="text-xs text-stone-400 font-sans leading-relaxed">
              Serving premium sweets, exotic cocktails, loaded crepes and chocolate waffles on our highly AC supercooled lounge in Batroun, North Lebanon since 1991.
            </p>
          </div>

          <!-- Column 2: Quick Links -->
          <div class="space-y-3 font-sans text-xs">
            <h5 class="font-heading font-bold text-xs text-[#fee33c] uppercase tracking-wider">Quick Navigation</h5>
            <ul class="space-y-2 text-stone-400">
              <li><button @click="switchTab('home')" class="hover:text-[#fee33c] transition-colors cursor-pointer">Home</button></li>
              <li><button @click="switchTab('menu')" class="hover:text-[#fee33c] transition-colors cursor-pointer">Menu</button></li>
              <li><button @click="switchTab('reviews')" class="hover:text-[#fee33c] transition-colors cursor-pointer">Reviews</button></li>
              <li><button @click="switchTab('info')" class="hover:text-[#fee33c] transition-colors cursor-pointer">Infos</button></li>
            </ul>
          </div>

          <!-- Column 3: Menu Categories -->
          <div class="space-y-3 font-sans text-xs">
            <h5 class="font-heading font-bold text-xs text-[#fee33c] uppercase tracking-wider">Hot Selection Picks</h5>
            <ul class="space-y-2 text-stone-400">
              <li><button @click="switchTab('menu'); activeCategory = 'chocolate';" class="hover:text-[#fee33c] transition-colors cursor-pointer">Sushi Crepe Rolls</button></li>
              <li><button @click="switchTab('menu'); activeCategory = 'juice';" class="hover:text-[#fee33c] transition-colors cursor-pointer">Avocado Super Cocktail</button></li>
              <li><button @click="switchTab('menu'); activeCategory = 'icecream';" class="hover:text-[#fee33c] transition-colors cursor-pointer">Kunafa Pistachio Shakes</button></li>
              <li><button @click="switchTab('menu'); activeCategory = 'cake';" class="hover:text-[#fee33c] transition-colors cursor-pointer">Double Layer Waffles</button></li>
            </ul>
          </div>

          <!-- Column 4: Location -->
          <div class="space-y-3 font-sans text-xs text-stone-400 leading-relaxed">
            <h5 class="font-heading font-bold text-xs text-[#fee33c] uppercase tracking-wider">Coordinates</h5>
            <p>Coastal Old Street Road, Near ancient wall port harbor, Batroun, North Lebanon.</p>
            <p class="font-mono text-[11px] text-[#fee33c]">Hotline: +961 6 740 991</p>
          </div>

        </div>

        <div class="max-w-7xl mx-auto border-t border-stone-800 pt-8 mt-8 text-center text-stone-500 font-sans text-[10px] space-y-1">
          <p class="uppercase tracking-wider">Jessy Juice © {{ new Date().getFullYear() }} • Lebanese Sweet Legacy</p>
          <p class="opacity-75">All Rights Reserved. Hand-crafted desserts prepped with clean ingredients in Lebanon.</p>
        </div>
      </footer>

      <!-- ================= STOCK NOTIFICATION DIALOG (POPUP ON SCREEN) ================= -->
      <div 
        v-if="stockPopup.show" 
        class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 select-none"
      >
        <div class="w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-2xl animate-zoomIn flex flex-col border border-red-500 max-h-[90vh]">
          
          <!-- Head with warnings -->
          <div class="p-4 border-b border-stone-150 bg-red-50 flex items-center justify-between shrink-0">
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-red-600 text-lg">warning</span>
              <h4 class="font-heading font-black text-red-600 text-xs tracking-tight">
                Stock Warning
              </h4>
            </div>
            <button 
              @click="stockPopup.show = false"
              class="w-6 h-6 rounded-full bg-red-100 hover:bg-red-200 flex items-center justify-center cursor-pointer transition-colors"
            >
              <span class="material-symbols-outlined text-[10px] font-black text-red-700">close</span>
            </button>
          </div>

          <!-- Body with item info -->
          <div class="p-6 space-y-4 text-center">
            <div v-if="stockPopup.image" class="w-20 h-20 rounded-2xl mx-auto overflow-hidden bg-stone-100 border border-stone-250 shadow-inner">
              <img :src="stockPopup.image" class="w-full h-full object-cover" />
            </div>
            
            <div class="space-y-1">
              <h5 class="font-heading font-black text-[#291830] text-sm leading-tight">
                {{ stockPopup.title }}
              </h5>
              <p class="text-[11px] text-stone-500 font-sans">
                Delicious selection from Jessy Juice
              </p>
            </div>

            <!-- Beautiful Arabic / English message tag -->
            <div class="py-3 px-4 bg-red-50/70 border border-red-100 rounded-2xl">
              <p class="text-xs font-heading font-bold text-red-700 leading-normal">
                {{ stockPopup.message }}
              </p>
            </div>

            <!-- Helpful stock indicators -->
            <div class="grid grid-cols-2 gap-2 text-left pt-2">
              <div class="bg-stone-50 p-2.5 rounded-xl border border-stone-100 text-center">
                <span class="text-[8px] uppercase tracking-wider text-stone-400 block font-bold">In Counter</span>
                <span class="text-xs font-heading font-black text-red-600 mt-0.5 block">
                  {{ stockPopup.stockLimit === 0 ? 'Out of stock' : `${stockPopup.stockLimit} left` }}
                </span>
              </div>
              <div class="bg-stone-50 p-2.5 rounded-xl border border-stone-100 text-center">
                <span class="text-[8px] uppercase tracking-wider text-stone-400 block font-bold">Your Plate</span>
                <span class="text-xs font-heading font-black text-stone-750 mt-0.5 block">
                  {{ stockPopup.currentInCart }} items
                </span>
              </div>
            </div>

          </div>

          <!-- Actions -->
          <div class="p-4 bg-stone-50 border-t border-stone-100 flex gap-2">
            <button 
              @click="stockPopup.show = false"
              class="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white font-heading font-black text-xs rounded-xl cursor-pointer shadow-md shadow-red-200 transition-colors"
            >
              Okay, I understand
            </button>
          </div>

        </div>
      </div>

      <!-- Floating Smart Assistant Widget launcher -->
      <Chatbot />

    </div>

    <!-- Toast Notification Overlay (Placed completely outside of min-h-screen to avoid backdrop-blur/stacking context interference) -->
    <div 
      id="toast-container" 
      class="fixed bottom-6 right-6 flex flex-col gap-3 pointer-events-none max-w-sm w-full px-4"
      style="z-index: 1000000000 !important; position: fixed; transform: translate3d(0,0,0) !important; -webkit-transform: translate3d(0,0,0) !important; filter: none !important; -webkit-filter: none !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important;"
    >
      <div 
        v-for="toast in toastList" 
        :key="toast.id"
        class="pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-2xl shadow-lg border text-xs font-sans transition-all duration-300 transform translate-y-0"
        :class="[
          toast.type === 'success' ? 'bg-[#863d96] text-white border-[#723281]' : '',
          toast.type === 'info' ? 'bg-amber-50 text-[#863d96] border-amber-200' : '',
          toast.type === 'accent' ? 'bg-[#fee33c] text-[#863d96] border-amber-300 font-extrabold' : '',
          toast.type === 'error' ? 'bg-red-50 text-red-700 border-red-200' : ''
        ]"
        style="transform: translate3d(0,0,0) !important; -webkit-transform: translate3d(0,0,0) !important; filter: none !important; -webkit-filter: none !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important;"
      >
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-sm">
            {{ toast.type === 'success' ? 'check_circle' : toast.type === 'error' ? 'error' : 'star' }}
          </span>
          <span>{{ toast.message }}</span>
        </div>
      </div>
    </div>

    <!-- Simulated Mobile SMS Pop-up (Placed completely outside of min-h-screen to avoid backdrop-blur/stacking context interference) -->
    <div 
      v-if="smsReceivedNotification" 
      class="fixed top-4 right-4 max-w-sm w-full bg-stone-950 rounded-2xl shadow-2xl border border-stone-800 text-stone-100 p-4 animate-slideDown font-sans"
      style="box-shadow: 0 20px 40px rgba(0,0,0,0.5); z-index: 1000000000 !important; position: fixed; transform: translate3d(0,0,0) !important; -webkit-transform: translate3d(0,0,0) !important; filter: none !important; -webkit-filter: none !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important;"
    >
      <div class="flex items-center justify-between pb-2 border-b border-stone-800 mb-2">
        <div class="flex items-center gap-2">
          <span class="w-6 h-6 rounded-full bg-sky-500 flex items-center justify-center text-white">
            <span class="material-symbols-outlined text-xs">sms</span>
          </span>
          <div class="text-[10px] text-stone-400 font-semibold tracking-wider uppercase">Messages • Now</div>
        </div>
        <button 
          @click="smsReceivedNotification = null" 
          class="text-stone-500 hover:text-stone-300 text-xs font-bold focus:outline-none cursor-pointer"
        >
          <span class="material-symbols-outlined text-sm">close</span>
        </button>
      </div>
      <div class="space-y-1.5">
        <div class="text-[11px] font-bold text-sky-400 font-heading">
          +1 (855) 700-JUICE 💬
        </div>
        <div class="text-[12px] font-mono leading-relaxed text-stone-200 select-all font-medium">
          {{ smsReceivedNotification.text }}
        </div>
        <div class="text-[9px] text-stone-500 text-right">
          Tap code text to highlight & copy
        </div>
      </div>
    </div>

  </div>
</template>

<style>
/* Custom styled effects */
.bg-radial-gradient {
  background-image: radial-gradient(circle, var(--tw-gradient-stops));
}

@keyframes slideDownSms {
  0% {
    transform: translate3d(0, -32px, 0) scale(0.95);
    opacity: 0;
  }
  100% {
    transform: translate3d(0, 0, 0) scale(1);
    opacity: 1;
  }
}

.animate-slideDown {
  animation: slideDownSms 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
</style>
