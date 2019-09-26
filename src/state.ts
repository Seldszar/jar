import EventEmitter from "events";
import fs from "fs";
import lodash from "lodash";
import path from "path";

export interface StateOptions<T> {
  defaultValue?: T;
}

export class State<T extends object> extends EventEmitter {
  public value: T;

  constructor(private path: string, options: StateOptions<T>) {
    super();

    this.ensureDirectory();

    this.on("change", newValue => {
      this.write(newValue);
    });

    try {
      this.value = this.read();
    } catch (error) {
      this.value = options.defaultValue;
    }
  }

  private serialize(value: T): string {
    return JSON.stringify(value, null, 2);
  }

  private deserialize(value: string): T {
    return JSON.parse(value);
  }

  private ensureDirectory(): void {
    fs.mkdirSync(path.dirname(this.path), {
      recursive: true,
    });
  }

  private read(): T {
    return this.deserialize(fs.readFileSync(this.path, "utf8"));
  }

  private write(value: T): void {
    fs.writeFileSync(this.path, this.serialize(value));
  }

  get<T>(name: string, defaultValue?: T): T {
    return lodash.get(this.value, name, defaultValue);
  }

  set<T>(name: string, value: T): void {
    this.emit("change", lodash.set(this.value, name, value));
  }

  unset(name: string): void {
    this.emit("change", lodash.unset(this.value, name));
  }

  update<T>(name: string, updater: (value: T) => T): void {
    return this.set(name, updater(this.get(name)));
  }
}
