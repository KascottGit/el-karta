import { expect } from '@playwright/test';

interface Message {
  ID: string;
  To: { Address: string }[];
}

/** Waits for the newest magic link sent to `email` by the local auth server. */
export async function magicLinkFor(email: string): Promise<string> {
  const mailpit = process.env['MAILPIT_URL'];
  if (!mailpit) throw new Error('MAILPIT_URL is not set');
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const search = (await (
          await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
        ).json()) as { messages: Message[] };
        const message = search.messages[0];
        if (!message) return undefined;
        const body = (await (await fetch(`${mailpit}/api/v1/message/${message.ID}`)).json()) as {
          Text: string;
        };
        link = /https?:\/\/\S+\/auth\/v1\/verify\?\S+/.exec(body.Text)?.[0];
        return link;
      },
      { timeout: 15_000 },
    )
    .toBeTruthy();
  return link!;
}
