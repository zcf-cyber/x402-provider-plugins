/** Minimal stubs for Pi extension authoring without installing the full Pi monorepo. */
declare module "@earendil-works/pi-coding-agent" {
  export interface ExtensionAPI {
    registerProvider(id: string, config: Record<string, unknown>): void;
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<unknown>): void;
    registerTool(tool: Record<string, unknown>): void;
    registerCommand(name: string, def: { description: string; handler: (...args: unknown[]) => Promise<void> }): void;
  }

  export interface ExtensionContext {
    ui: {
      notify(message: string, level: string): void;
      confirm(title: string, message: string): Promise<boolean>;
      input(title: string, message: string): Promise<string | undefined>;
    };
  }
}

declare module "typebox" {
  export const Type: {
    Object: (props: Record<string, unknown>) => unknown;
    String: (opts?: Record<string, unknown>) => unknown;
    Optional: (t: unknown) => unknown;
  };
}
