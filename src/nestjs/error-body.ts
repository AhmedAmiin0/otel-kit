import { HttpException } from '@nestjs/common';

/** The body Nest will send for an exception, for logging purposes. */
export const errorResponseBody = (exception: unknown): unknown =>
  exception instanceof HttpException
    ? exception.getResponse()
    : { statusCode: 500, message: 'Internal server error' };
