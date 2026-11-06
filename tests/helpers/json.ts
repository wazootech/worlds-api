/** Reads a JSON response body as the shape the calling test asserts on. */
export async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export interface ErrorBody {
  error: { code: string; message: string };
}
