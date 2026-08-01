import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { TelemetryService } from 'otel-kit/nestjs';
import { firstValueFrom } from 'rxjs';

const JSONPLACEHOLDER = 'https://jsonplaceholder.typicode.com/posts';

export interface Draft {
  title: string;
  body: string;
  userId: number;
  /** Never reaches the logs: `apiKey` is a default redaction key. */
  apiKey?: string;
}

@Injectable()
export class PostsService {
  /** TelemetryService is exported by ObservabilityModule; nothing else to register. */
  constructor(
    private readonly http: HttpService,
    private readonly telemetry: TelemetryService,
  ) {}

  /**
   * One outbound call, so HttpClientLogger has something to report.
   *
   * apiKey is dropped rather than forwarded: redaction keeps secrets out of the
   * logs, it does not make them safe to send on to a third party.
   */
  async publish({ apiKey: _apiKey, ...draft }: Draft): Promise<unknown> {
    return this.telemetry.withSpan('posts.publish', async () => {
      const { data } = await firstValueFrom(this.http.post(JSONPLACEHOLDER, draft));
      this.telemetry.increment('demo.posts.published', { user_id: String(draft.userId) });
      return { published: data };
    });
  }
}
