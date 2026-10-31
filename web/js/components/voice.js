// A microphone button that types what you say into a text box, using the
// browser's speech recognition (Chrome, Edge and Safari). Browsers only allow
// the microphone on secure pages: HTTPS, or localhost.

import { h, icon, toast } from "../ui.js";

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

/** Whether this browser, on this page, can listen. */
export function canListen() {
  return Boolean(Recognition) && window.isSecureContext;
}

function whyNot() {
  if (!Recognition) return "Voice input needs Chrome, Edge or Safari.";
  return "Voice input needs a secure page: open the app through its https:// address.";
}

/**
 * A button that dictates into `target` (an input or textarea), adding to what
 * is there. `onDone(text)` runs when listening stops.
 */
export function voiceButton(target, { onDone = () => {}, label = "Speak" } = {}) {
  let recognition = null;
  let base = "";
  const button = h("button", { type: "button", class: "btn voice-btn", title: canListen() ? "Speak instead of typing" : whyNot(), "aria-pressed": "false" },
    icon("mic"), h("span", { class: "voice-label" }, label));

  function stop() {
    recognition?.stop();
  }

  function start() {
    if (!canListen()) {
      toast(whyNot(), "error");
      return;
    }
    recognition = new Recognition();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    base = target.value.trim() ? `${target.value.trim()} ` : "";
    recognition.onresult = (event) => {
      let finalText = "";
      let interim = "";
      for (const result of event.results) {
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      target.value = `${base}${finalText}${interim}`.replace(/\s+/g, " ");
      target.dispatchEvent(new Event("input", { bubbles: true }));
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") toast("Microphone access was blocked. Allow it in the browser to use voice.", "error");
      else if (event.error !== "aborted" && event.error !== "no-speech") toast(`Voice input stopped: ${event.error}`, "error");
    };
    recognition.onend = () => {
      recognition = null;
      button.classList.remove("listening");
      button.setAttribute("aria-pressed", "false");
      button.querySelector(".voice-label").textContent = label;
      onDone(target.value);
    };
    recognition.start();
    button.classList.add("listening");
    button.setAttribute("aria-pressed", "true");
    button.querySelector(".voice-label").textContent = "Listening… tap to stop";
  }

  button.addEventListener("click", () => (recognition ? stop() : start()));
  return button;
}
