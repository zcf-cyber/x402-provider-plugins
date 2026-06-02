import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mWrap, mRegister, mRegisterV1, mOnPaymentCreation, mOnPaymentResponse,
} = vi.hoisted(() => ({
  mWrap: vi.fn<(f: typeof fetch, _c: unknown) => typeof fetch>((f) => f),
  mRegister: vi.fn(),
  mRegisterV1: vi.fn(),
  mOnPaymentCreation: vi.fn(),
  mOnPaymentResponse: vi.fn(),
}));

vi.mock("@x402/fetch", () => ({ wrapFetchWithPayment: mWrap }));
vi.mock("@x402/core/client", () => ({
  x402Client: vi.fn(function (this: Record<string, unknown>) {
    this.register = mRegister; this.registerV1 = mRegisterV1;
    this.onAfterPaymentCreation = mOnPaymentCreation;
    this.onPaymentResponse = mOnPaymentResponse;
  }),
  x402HTTPClient: vi.fn(),
}));

import { V2ProtocolHandler } from "../protocol/V2ProtocolHandler.js";

const mockClient = { scheme: "exact_evm", createPaymentPayload: vi.fn() };

describe("V2ProtocolHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should register V2 scheme by default", () => {
      new V2ProtocolHandler("eip155:8453", 2, mockClient as any);
      expect(mRegister).toHaveBeenCalledWith("eip155:8453", mockClient);
      expect(mRegisterV1).not.toHaveBeenCalled();
    });
    it("should register V1 scheme when protocolVersion is 1", () => {
      new V2ProtocolHandler("base", 1, mockClient as any);
      expect(mRegisterV1).toHaveBeenCalledWith("base", mockClient);
      expect(mRegister).not.toHaveBeenCalled();
    });
  });

  describe("wrapFetch", () => {
    it("should delegate to @x402/fetch and return a callable function", async () => {
      const h = new V2ProtocolHandler("eip155:8453", 2, mockClient as any);
      const r = new Response("ok", { status: 200 });
      const bf = vi.fn().mockResolvedValue(r) as unknown as typeof fetch;
      const w = h.wrapFetch(bf);
      const resp = await w("https://example.com");
      expect(mWrap).toHaveBeenCalledWith(bf, expect.any(Object));
      expect(bf).toHaveBeenCalledWith("https://example.com");
      expect(resp.status).toBe(200);
    });
  });

  describe("registerAuditHooks", () => {
    it("should register both lifecycle hooks", () => {
      const h = new V2ProtocolHandler("eip155:8453", 2, mockClient as any);
      h.registerAuditHooks(vi.fn(), () => "rid");
      expect(mOnPaymentCreation).toHaveBeenCalledTimes(1);
      expect(mOnPaymentResponse).toHaveBeenCalledTimes(1);
    });
    it("should emit 'signed' phase from payment creation hook", async () => {
      const h = new V2ProtocolHandler("eip155:8453", 2, mockClient as any);
      const e: Array<{ phase: string; requestId: string }> = [];
      h.registerAuditHooks((x) => e.push({ phase: x.phase, requestId: x.requestId }), () => "req-1");
      const cb = mOnPaymentCreation.mock.calls[0]?.[0];
      if (cb) await cb({ paymentRequired: { resource: "/v1/chat" } });
      expect(e).toEqual([{ phase: "signed", requestId: "req-1" }]);
    });
    it("should emit 'settled' or 'error' phase from payment response hook", async () => {
      const h = new V2ProtocolHandler("eip155:8453", 2, mockClient as any);
      const e: Array<{ phase: string; requestId: string }> = [];
      h.registerAuditHooks((x) => e.push({ phase: x.phase, requestId: x.requestId }), () => "req-2");
      const cb = mOnPaymentResponse.mock.calls[0]?.[0];
      if (cb) await cb({ settleResponse: { success: true } });
      expect(e[0]).toMatchObject({ phase: "settled", requestId: "req-2" });
      e.length = 0;
      if (cb) await cb({ settleResponse: { success: false } });
      expect(e[0]).toMatchObject({ phase: "error", requestId: "req-2" });
    });
  });
});
