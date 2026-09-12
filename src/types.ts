/** A USB device as reported by `usbipd.exe state --json` on the Windows side. */
export interface UsbipdDevice {
  BusId?: string;
  InstanceId?: string;
  Description?: string;
  /** usbipd reports this as "Attached" / "Shared" / "Not shared" depending on version. */
  ClientIPAddress?: string | null;
  IsForced?: boolean;
  PersistedGuid?: string | null;
}

/** Connection state of an adb device, straight from `adb devices`. */
export type AdbDeviceState =
  | 'device'
  | 'unauthorized'
  | 'offline'
  | 'no permissions'
  | 'authorizing'
  | 'recovery'
  | 'sideload'
  | 'bootloader'
  | 'unknown';

export interface AdbDevice {
  serial: string;
  state: AdbDeviceState;
  /** True for `emulator-5554` style serials, which never involve usbipd. */
  isEmulator: boolean;
}

/** One `adb reverse` mapping: the device port forwards to a host port. */
export interface ReversePort {
  device: number;
  host: number;
  label?: string;
}

export type Target = 'device' | 'emulator';

export interface VariantConfig {
  devClientPackage: string;
  reverses: ReversePort[];
}

export interface Config {
  defaultVariant: string;
  variants: Record<string, VariantConfig>;
  avd?: string;
  /** Hostname handed to Metro. Only `dev` can enforce it; see docs. */
  packagerHostname: string;
}

/** Everything the tool can observe before deciding to change anything. */
export interface ObservedState {
  isWsl: boolean;
  missingTools: string[];
  usbipd: {
    available: boolean;
    phone: UsbipdDevice | null;
    attached: boolean;
  };
  adbServerReachable: boolean;
  devices: AdbDevice[];
  selectedSerial: string | null;
  reverses: ReversePort[];
  devClientInstalled: boolean | null;
  packagerHostname: string | null;
}

export type ActionKind =
  | 'install-tool'
  | 'usbipd-bind'
  | 'usbipd-attach'
  | 'start-adb-server'
  | 'add-reverse'
  | 'authorize-device'
  | 'install-dev-client'
  | 'set-packager-hostname';

export interface Action {
  kind: ActionKind;
  /** Human-facing sentence. This is what `doctor` prints. */
  summary: string;
  /** Whether `up` can perform it, or whether it needs the human. */
  automatic: boolean;
  /** Shell hint shown when `automatic` is false. */
  manualHint?: string;
  detail?: Record<string, string | number | boolean>;
}
