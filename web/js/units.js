// Numbers in the reader's units. Temperatures and heights show both scales,
// the reader's own first; US English readers get °F, mph and feet first.

/** Whether the reader uses °F, mph, miles and feet. */
export const imperial = /^en-US\b/.test(navigator.language || "") || navigator.language === "en";

const fahrenheit = (celsius) => `${Math.round(celsius * 1.8 + 32)}°F`;
const celsiusText = (celsius) => `${Math.round(celsius)}°C`;
const feet = (metres) => `${Math.round(metres * 3.281).toLocaleString()} ft`;
const metresText = (metres) => `${Math.round(metres).toLocaleString()} m`;

/** Both scales, the reader's own first: "43°F (6°C)". */
export function temperature(celsius) {
  const [main, other] = temperatureParts(celsius);
  return `${main} (${other})`;
}

/** The reader's scale and the other one, for showing on two lines. */
export function temperatureParts(celsius) {
  return imperial ? [fahrenheit(celsius), celsiusText(celsius)] : [celsiusText(celsius), fahrenheit(celsius)];
}

/** Both units, the reader's own first: "5,440 ft (1,658 m)". */
export function height(metres) {
  return imperial ? `${feet(metres)} (${metresText(metres)})` : `${metresText(metres)} (${feet(metres)})`;
}

export function speed(kmh) {
  return imperial ? `${Math.round(kmh * 0.621)} mph` : `${Math.round(kmh)} km/h`;
}

export function distance(km) {
  return imperial ? `${Math.round(km * 0.621)} mi` : `${Math.round(km)} km`;
}
