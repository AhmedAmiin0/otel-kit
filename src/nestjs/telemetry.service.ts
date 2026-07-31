import { Injectable } from '@nestjs/common';
import { Telemetry } from '../core/telemetry/telemetry';

/** Injectable view of the framework-free core class. */
@Injectable()
export class TelemetryService extends Telemetry {}
