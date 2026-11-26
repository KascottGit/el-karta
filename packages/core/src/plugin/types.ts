import type { z } from 'zod';
import type { Device, Model, PlacementKind } from '../schemas/index.ts';
import type { Issue } from '../validation/issue.ts';

export interface PortDef {
  kind: string;
  /** Defaults to the device's own domain; a printer has a power port and a network port. */
  domain?: string;
  labelKey?: string;
}

export interface DeviceTypeDef {
  type: string;
  labelKey: string;
  icon: string;
  placements: readonly PlacementKind[];
  defaultHeight?: number;
  defaultPorts: readonly PortDef[];
  props: z.ZodType;
  /** Port pairs that conduct through the device (a patch panel's front/back port). Absent: all ports are joined. */
  portLinks?: (device: Device) => Iterable<readonly [string, string]>;
}

export interface ConnectionKindDef {
  kind: string;
  labelKey: string;
  fromPortKinds: readonly string[];
  toPortKinds: readonly string[];
}

export interface ContainerTypeDef {
  deviceType: string;
  accepts: readonly string[];
  slotCount: (device: Device) => number;
}

export interface LabelTemplate {
  id: string;
  labelKey: string;
  /** `{n}` is replaced by an auto-incremented number, e.g. `UC2-F{n}`. */
  pattern: string;
  deviceTypes: readonly string[];
}

/**
 * What photo detection (M11) may report for one device type. Text is English, for the prompt; the
 * type's placements and default height come from its `DeviceTypeDef`.
 */
export interface PhotoHint {
  type: string;
  /** What the device looks like, for the prompt. */
  description: string;
  /** Props the model may read off a photo, each with its allowed values. */
  visibleProps?: Readonly<Record<string, readonly string[]>>;
  /** Whether one device can hold several units side by side (a double outlet), as `Device.count`. */
  countable?: boolean;
}

/** Vocabulary a plugin gives the AI passes, so a new domain is detected without changing a pass. */
export interface AiHints {
  photo?: readonly PhotoHint[];
}

export interface DomainPlugin {
  id: string;
  nameKey: string;
  deviceTypes: readonly DeviceTypeDef[];
  connectionKinds: readonly ConnectionKindDef[];
  /** Connection kinds followed when tracing; include `CONTAINS` if a container conducts to its children. */
  traceKinds: readonly string[];
  validate?: (model: Model) => Issue[];
  labelTemplates?: readonly LabelTemplate[];
  containerTypes?: readonly ContainerTypeDef[];
  aiHints?: AiHints;
}
