import { Global, Injectable, Module } from "@nestjs/common";

// Everything that needs "now" asks the Clock instead of calling new Date().
// Tests replace it with a fixed time (e.g. 23:00 UTC) to prove the kitchen-zone logic.
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}

@Global()
@Module({ providers: [Clock], exports: [Clock] })
export class ClockModule {}
