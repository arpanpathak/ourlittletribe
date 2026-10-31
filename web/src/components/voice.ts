// A microphone button that types what you say into a text box, using the
// browser's speech recognition (Chrome, Edge and Safari). Browsers only allow
// the microphone on secure pages: HTTPS, or localhost.

import { h } from "../dom.js";
import { icon } from "../icons.js";
import { toast } from "../ui/feedback.js";

/** One guess at what was said. */
interface Alternative {
  /** The words. */
  transcript: string;
}

/** What was heard for one stretch of speech. */
interface SpeechResult {
  /** Whether the browser has settled on the words. */
  readonly isFinal: boolean;
  /** The best guess. */
  readonly 0: Alternative;
}

/** The part of the browser's speech recognition this button uses. */
interface Recognizer {
  /** The language to listen for, such as "en-US". */
  lang: string;
  /** Keeps listening through pauses. */
  continuous: boolean;
  /** Reports words before they are settled. */
  interimResults: boolean;
  /** Called as words arrive. */
  onresult: ((event: { results: ArrayLike<SpeechResult> }) => void) | null;
  /** Called when listening fails. */
  onerror: ((event: { error: string }) => void) | null;
  /** Called when listening stops, for any reason. */
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

/** The constructor, under whichever name this browser uses. */
type RecognizerClass = new () => Recognizer;

const speechWindow = window as unknown as { SpeechRecognition?: RecognizerClass; webkitSpeechRecognition?: RecognizerClass };
const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;

/** Errors that just mean the person stopped or said nothing. */
const QUIET_ERRORS = ["aborted", "no-speech"];

/** Errors that mean the microphone is blocked. */
const BLOCKED_ERRORS = ["not-allowed", "service-not-allowed"];

/** Whether this browser, on this page, can listen. */
export function canListen(): boolean {
  return Recognition !== null && window.isSecureContext;
}

function whyNot(): string {
  if (!Recognition) return "Voice input needs Chrome, Edge or Safari.";
  return "Voice input needs a secure page: open the app through its https:// address.";
}

function reportError(error: string): void {
  if (QUIET_ERRORS.includes(error)) return;

  const blocked = BLOCKED_ERRORS.includes(error);
  toast(blocked ? "Microphone access was blocked. Allow it in the browser to use voice." : `Voice input stopped: ${error}`, "error");
}

/** What a voice button can be told. */
export interface VoiceOptions {
  /** The button's words while idle. */
  label?: string;
  /** Called with the box's text when listening stops. */
  onDone?: (text: string) => void;
}

/** A button that dictates into `target`, adding to what is there. */
export function voiceButton(target: HTMLInputElement | HTMLTextAreaElement, options: VoiceOptions = {}): HTMLButtonElement {
  const label = options.label ?? "Speak";
  const labelText = h("span", { class: "voice-label" }, label);
  const button = h("button", { type: "button", class: "btn voice-btn", title: canListen() ? "Speak instead of typing" : whyNot(), "aria-pressed": "false" }, icon("mic"), labelText);

  let recognizer: Recognizer | null = null;

  function show(listening: boolean): void {
    button.classList.toggle("listening", listening);
    button.setAttribute("aria-pressed", String(listening));
    labelText.textContent = listening ? "Listening… tap to stop" : label;
  }

  function write(base: string, results: ArrayLike<SpeechResult>): void {
    const heard = Array.from(results, (result) => result[0].transcript).join("");
    target.value = `${base}${heard}`.replace(/\s+/g, " ");
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function start(Recognizer: RecognizerClass): void {
    const base = target.value.trim() ? `${target.value.trim()} ` : "";
    const listener = new Recognizer();
    listener.lang = navigator.language || "en-US";
    listener.continuous = true;
    listener.interimResults = true;

    listener.onresult = (event) => write(base, event.results);
    listener.onerror = (event) => reportError(event.error);
    listener.onend = () => {
      recognizer = null;
      show(false);
      options.onDone?.(target.value);
    };

    recognizer = listener;
    listener.start();
    show(true);
  }

  button.addEventListener("click", () => {
    if (recognizer) {
      recognizer.stop();
      return;
    }
    if (!Recognition || !canListen()) {
      toast(whyNot(), "error");
      return;
    }
    start(Recognition);
  });
  return button;
}
