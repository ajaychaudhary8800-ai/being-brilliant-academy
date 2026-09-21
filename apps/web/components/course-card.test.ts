import assert from "node:assert/strict";
import test from "node:test";
import { courseDisplayPricePaise } from "./course-card";

test("public course cards prefer current paise fields", () => {
  assert.equal(courseDisplayPricePaise({ title:"A", slug:"a", description:"", salePricePaise:1199900, regularPricePaise:1999900 }),1199900);
  assert.equal(courseDisplayPricePaise({ title:"A", slug:"a", description:"", regularPricePaise:1999900 }),1999900);
});

test("public course cards remain compatible with legacy price fields and never produce NaN", () => {
  assert.equal(courseDisplayPricePaise({ title:"A", slug:"a", description:"", salePrice:1499900, price:2499900 }),1499900);
  assert.equal(courseDisplayPricePaise({ title:"A", slug:"a", description:"" }),0);
});
