import type { ScopedOpencodeClient, PendingQuestionAnswer, PendingQuestionRequest } from '@/shared/protocol/opencode/client/types';
import { mapPermission, formToQuestion, mapSavedPermission, toAnswer } from '@/shared/protocol/opencode/v2/mappers';
const location = (client: ScopedOpencodeClient) => ({ location: { directory: client.__opencode.directory } });
export async function listPendingPermissions(client: ScopedOpencodeClient) {
  if (client.compatibility) return (await client.compatibility.permission.list()).data;
  return (await client.api!.permission.request.list(location(client))).data.map((item) => mapPermission(item, client.context));
}
export async function listPendingQuestions(client: ScopedOpencodeClient): Promise<PendingQuestionRequest[] | undefined> {
  if (client.compatibility) return (await client.compatibility.question.list()).data;
  return (await client.api!.form.list(location(client))).data.map((item) => formToQuestion(item, client.context));
}
export async function listPendingInteractions(client: ScopedOpencodeClient) {
  const [permissions, questions] = await Promise.allSettled([listPendingPermissions(client), listPendingQuestions(client)]);
  const p = permissions.status === 'fulfilled' ? permissions.value : undefined;
  const q = questions.status === 'fulfilled' ? questions.value : undefined;
  if (!p && !q) throw permissions.status === 'rejected' ? permissions.reason : questions.status === 'rejected' ? questions.reason : new Error('OpenCode did not return pending interactions.');
  return { permissions: p, questions: q };
}
async function permissionSession(client: ScopedOpencodeClient, id: string) {
  if (!client.context!.permissionSession.has(id)) await listPendingPermissions(client);
  const sessionID = client.context!.permissionSession.get(id);
  if (!sessionID) throw new Error('This permission request is no longer available.');
  return sessionID;
}
async function form(client: ScopedOpencodeClient, id: string) {
  if (!client.context!.formSession.has(id)) await listPendingQuestions(client);
  const request = client.context!.formSession.get(id);
  if (!request) throw new Error('This question is no longer available.');
  return request;
}
export async function replyToPendingPermission(client: ScopedOpencodeClient, requestID: string, reply: 'once' | 'always' | 'reject') {
  if (client.compatibility) { await client.compatibility.permission.reply({ requestID, reply }); return; }
  await client.api!.permission.reply({ sessionID: await permissionSession(client, requestID), requestID, decision: reply });
  client.context!.permissionSession.delete(requestID);
}
export async function replyToPendingQuestion(client: ScopedOpencodeClient, requestID: string, answers: PendingQuestionAnswer[]) {
  if (client.compatibility) { await client.compatibility.question.reply({ requestID, answers }); return; }
  const request = await form(client, requestID);
  await client.api!.session.form.reply({ sessionID: request.sessionID, formID: request.id, answer: toAnswer(request, answers) });
  client.context!.formSession.delete(requestID);
}
export async function rejectPendingQuestion(client: ScopedOpencodeClient, requestID: string) {
  if (client.compatibility) { await client.compatibility.question.reject({ requestID }); return; }
  const request = await form(client, requestID);
  await client.api!.session.form.cancel({ sessionID: request.sessionID, formID: request.id });
  client.context!.formSession.delete(requestID);
}
export async function listSavedPermissionRules(client: ScopedOpencodeClient) {
  return client.api ? (await client.api.permission.saved.list()).map(mapSavedPermission) : [];
}
export async function removeSavedPermissionRule(client: ScopedOpencodeClient, id: string) {
  if (!client.api) throw new Error('Saved permission rules require OpenCode 2.');
  await client.api.permission.saved.remove({ id });
}
