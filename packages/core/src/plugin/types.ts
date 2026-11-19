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
}
