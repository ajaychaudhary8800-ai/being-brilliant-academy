import assert from "node:assert/strict";
import test from "node:test";
import { assertSchoolOSNewTermDoesNotOverlap, schoolOSRenewalReadiness } from "./schoolos-renewal-policy.js";
const now=new Date("2026-10-19T00:00:00Z");
const term={id:"paid-one",status:"PAID",schoolOSQuoteId:"quote-one",
 periodStart:new Date("2026-01-01T00:00:00Z"),periodEnd:new Date("2027-01-01T00:00:00Z")};
test("new quoted term cannot overlap existing paid SaaS term",()=>{
 assert.throws(()=>assertSchoolOSNewTermDoesNotOverlap([term],now,new Date("2027-10-19T00:00:00Z")),
 /overlaps/);
 assert.doesNotThrow(()=>assertSchoolOSNewTermDoesNotOverlap([term],new Date("2027-01-01"),new Date("2028-01-01")));
});
test("expired paid term permits only fresh signed quote (never automatic renewal)",()=>{
 const state=schoolOSRenewalReadiness([term],{subscriptionStatus:"PAST_DUE",subscriptionEnd:null,cancelAtPeriodEnd:false},[],new Date("2027-01-01"));
 assert.equal(state.status,"PAID_TERM_EXPIRED");
 assert.equal(state.checkoutRecommendation,"REQUIRE_NEW_SIGNED_QUOTE");
 assert.equal(state.automaticRenewalEnabled,false);
});
test("unused prior term credits expire without changing immutable ledger",()=>{
 const credit={metric:"ai_credits",periodStart:term.periodStart,periodEnd:term.periodEnd,grantedUnits:100,consumedUnits:40};
 const current=schoolOSRenewalReadiness([term],{subscriptionStatus:"ACTIVE",subscriptionEnd:term.periodEnd,cancelAtPeriodEnd:false},[credit],now);
 assert.equal(current.credits[0]?.usableNowUnits,60);
 const old=schoolOSRenewalReadiness([term],null,[credit],new Date("2027-01-01"));
 assert.equal(old.credits[0]?.ledgerRemainingUnits,60);
 assert.equal(old.credits[0]?.usableNowUnits,0);
 assert.equal(old.credits[0]?.expired,true);
 assert.equal(old.expiredCreditsCarryOver,false);
});
test("period-invalid checkout rejected; cancellation preserves current-term already purchased credits",()=>{
 assert.throws(()=>assertSchoolOSNewTermDoesNotOverlap([],now,now));
 const state=schoolOSRenewalReadiness([term],{subscriptionStatus:"ACTIVE",subscriptionEnd:term.periodEnd,cancelAtPeriodEnd:true},
 [{metric:"video_minutes",periodStart:term.periodStart,periodEnd:term.periodEnd,grantedUnits:55,consumedUnits:5}],now);
 assert.equal(state.checkoutRecommendation,"BLOCK_OVERLAPPING_CHECKOUT");
 assert.equal(state.credits[0]?.usableNowUnits,50);
});
