declare module "input" {
  interface PromptOptions {
    default?: string;
  }

  interface Input {
    text(label?: string, options?: PromptOptions): Promise<string>;
    password(label?: string, options?: PromptOptions): Promise<string>;
  }

  const input: Input;

  export default input;
}
