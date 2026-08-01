import { fromMessageFirst, type MessageFirstLogger } from '../core/logger/adapt';
import type { ObsLogger } from '../core/logger/types';

/** The part of winston's Logger this needs; avoids a value import of winston. */
export type WinstonLike = MessageFirstLogger;

/** winston takes (message, meta); ObsLogger takes (obj, msg). */
export const createWinstonLogger = (winston: WinstonLike): ObsLogger =>
  fromMessageFirst(winston);
