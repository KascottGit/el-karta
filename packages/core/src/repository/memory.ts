import { parseFloorRecord, parseProjectRecord } from '../migrations/index.ts';
import type { FloorRecord, Id, Model, ProjectRecord } from '../schemas/index.ts';
import {
  NotFoundError,
  type ProjectSummary,
  type Repository,
  type SaveResult,
} from './repository.ts';

interface StoredProject {
  project: string;
  floors: Map<Id, string>;
}

/** Runs synchronously but reports errors as rejected promises, like a remote repository would. */
const settle = <T>(fn: () => T | Promise<T>): Promise<T> => {
  try {
    return Promise.resolve(fn());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
};

/** Stores serialized documents and parses them on load, like a database would. For tests, demos and offline tooling. */
export class InMemoryRepository implements Repository {
  readonly #projects = new Map<Id, StoredProject>();

  listProjects(): Promise<ProjectSummary[]> {
    return settle(() =>
      [...this.#projects.values()].map(({ project }) => {
        const { id, name, kind } = parseProjectRecord(JSON.parse(project));
        return { id, name, kind };
      }),
    );
  }

  loadProject(projectId: Id): Promise<Model> {
    return settle(() => {
      const stored = this.#get(projectId);
      const floors: Record<Id, FloorRecord> = {};
      for (const raw of stored.floors.values()) {
        const floor = parseFloorRecord(JSON.parse(raw));
        floors[floor.id] = floor;
      }
      return { project: parseProjectRecord(JSON.parse(stored.project)), floors };
    });
  }

  createProject(model: Model): Promise<Model> {
    return settle(() => {
      if (this.#projects.has(model.project.id))
        throw new Error(`Project ${model.project.id} already exists`);
      this.#projects.set(model.project.id, {
        project: JSON.stringify(model.project),
        floors: new Map(
          Object.values(model.floors).map((floor) => [floor.id, JSON.stringify(floor)]),
        ),
      });
      return this.loadProject(model.project.id);
    });
  }

  saveProject(record: ProjectRecord, expectedVersion: number): Promise<SaveResult<ProjectRecord>> {
    return settle(() => {
      const stored = this.#get(record.id);
      const current = parseProjectRecord(JSON.parse(stored.project));
      if (current.version !== expectedVersion) return { ok: false, latest: current };
      const saved = { ...record, version: expectedVersion + 1 };
      stored.project = JSON.stringify(saved);
      return { ok: true, record: saved };
    });
  }

  saveFloor(record: FloorRecord, expectedVersion: number): Promise<SaveResult<FloorRecord>> {
    return settle(() => {
      const raw = this.#get(record.projectId).floors.get(record.id);
      if (raw === undefined) throw new NotFoundError(`Floor ${record.id} not found`);
      const current = parseFloorRecord(JSON.parse(raw));
      if (current.version !== expectedVersion) return { ok: false, latest: current };
      const saved = { ...record, version: expectedVersion + 1 };
      this.#get(record.projectId).floors.set(record.id, JSON.stringify(saved));
      return { ok: true, record: saved };
    });
  }

  #get(projectId: Id): StoredProject {
    const stored = this.#projects.get(projectId);
    if (!stored) throw new NotFoundError(`Project ${projectId} not found`);
    return stored;
  }
}
