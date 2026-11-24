/**
 * Texto útil para el log a partir de cualquier error. Node lanza `AggregateError` sin mensaje cuando una conexión
 * falla en todas las direcciones (IPv6 e IPv4), y algunos errores de red solo traen `code`.
 */
export function describirError(e: unknown): string {
  if (e instanceof AggregateError && !e.message && e.errors.length > 0) {
    return e.errors.map((x: unknown) => describirError(x)).join('; ');
  }
  if (e instanceof Error) {
    if (e.message) return e.message;
    const codigo = (e as Error & { code?: unknown }).code;
    if (typeof codigo === 'string' && codigo) return codigo;
    return e.name || 'error desconocido';
  }
  if (e === undefined || e === null) return 'error desconocido';
  return String(e);
}
