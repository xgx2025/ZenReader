import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { useSettingsStore } from './stores/settings'

// Bundled Noto Serif SC (variable, unicode-range chunks) — reading never
// depends on fonts the user happens to have installed.
import '@fontsource-variable/noto-serif-sc'

import './assets/styles/main.css'
import './assets/styles/typography.css'
import './assets/styles/motion.css'

const app = createApp(App)

const pinia = createPinia()
app.use(pinia)
app.use(router)

// Load persisted settings (settings.json in Tauri, localStorage in browser)
// before the first paint, so the theme and last vault are restored correctly.
const settings = useSettingsStore(pinia)
settings.init().finally(() => {
  app.mount('#app')
})
