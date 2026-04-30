import { Location } from 'fhir/r4b';

// Per-Location physical Rectangle Health Card-Present terminal serial.
// One device per FHIR Location; serial lives on `Location.identifier`.
export const RH_TERMINAL_DEVICE_SYSTEM = 'https://fhir.oystehr.com/PaymentIdSystem/rectangle-health/terminal-device';

// Fixture serial used in dev/sandbox when a Location has no real device serial registered.
export const RH_TERMINAL_DEVICE_FIXTURE_SERIAL = 'UAT-DEVICE-1';

export const getRHTerminalSerialFromLocation = (loc: Location): string | undefined => {
  return loc.identifier?.find((ident) => ident.system === RH_TERMINAL_DEVICE_SYSTEM)?.value;
};
