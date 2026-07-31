import { Injectable } from '@nestjs/common';
import { Telemetry } from '../core/telemetry/telemetry';

/**
 * Nest-injectable view of the framework-free core Telemetry class.
 *
 * getContext no longer takes a `name`: it existed only to name the orphan
 * span the old implementation created and never ended.
 */
@Injectable()
export class TelemetryService extends Telemetry {}
