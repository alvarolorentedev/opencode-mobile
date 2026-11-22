const owners = new WeakMap<object, symbol>();

export function projectClientOwner(client: object) {
  const previous = owners.get(client);
  if (previous) return previous;
  const owner = Symbol();
  owners.set(client, owner);
  return owner;
}
