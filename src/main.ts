import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";
import { initStore } from "./store";

initStore();
createApp(App).mount("#app");
