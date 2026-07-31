import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import type {
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import type { ObservabilityConfig } from '../core/config/types';
import { OBSERVABILITY_CONFIG } from './tokens';
import { redactAndSerialize } from '../core/redaction/redact';

const instrumented = new WeakSet<object>();

@Injectable()
export class HttpClientLogger implements OnModuleInit {
  private readonly logger = new Logger('HttpClient');
  private readonly startedAt = new WeakMap<object, number>();
  constructor(
    private readonly http: HttpService,
    @Inject(OBSERVABILITY_CONFIG)
    private readonly config: ObservabilityConfig,
  ) {}

  onModuleInit(): void {
    const axios = this.http.axiosRef;
    if (instrumented.has(axios)) return;
    instrumented.add(axios);

    axios.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      this.startedAt.set(config, Date.now());
      const method = config.method?.toUpperCase() ?? 'GET';
      this.logger.log({
        event: 'http_client.request',
        msg: `--> ${method} ${config.url}`,
        client_method: method,
        client_url: config.url,
        client_req_body: redactAndSerialize(config.data, this.config.redaction),
      });
      return config;
    });

    axios.interceptors.response.use(
      (response: AxiosResponse) => {
        const method = response.config.method?.toUpperCase() ?? 'GET';
        const ms = this.elapsed(response.config);
        this.logger.log({
          event: 'http_client.response',
          msg: `<-- ${method} ${response.config.url} ${response.status} ${ms}ms`,
          client_method: method,
          client_url: response.config.url,
          client_res_status: response.status,
          client_res_body: redactAndSerialize(
            response.data,
            this.config.redaction,
          ),
          client_duration_ms: ms,
        });
        return response;
      },
      (error: AxiosError) => {
        const config = error.config;
        const method = config?.method?.toUpperCase() ?? 'GET';
        const ms = config ? this.elapsed(config) : 0;
        this.logger.warn({
          event: 'http_client.error',
          msg: `<-- ${method} ${config?.url} failed ${ms}ms`,
          client_method: method,
          client_url: config?.url,
          client_res_status: error.response?.status,
          client_res_body: error.response
            ? redactAndSerialize(error.response.data, this.config.redaction)
            : undefined,
          client_duration_ms: ms,
          error: error.message,
        });
        return Promise.reject(error);
      },
    );
  }

  private elapsed(config: object): number {
    const start = this.startedAt.get(config);
    return start === undefined ? 0 : Date.now() - start;
  }
}
