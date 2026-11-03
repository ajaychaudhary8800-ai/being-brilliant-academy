"""Synthetic Phase-1 rollback evidence only. No real customer or staging assets."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location(
    "rollback_policy",HERE/"schoolos-v5-phase1-rollback-evidence-gate.py"
)
GATE=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)

def receipt(state="PASS"):
    return {"result":state, "ref":"EVIDENCE-SYNTHETIC_ONLY_123"}

def sample():
    # Five separate OCI image digests across candidate and *previous* pair.
    new_images={
        role:{
            "image_digest":"sha256:"+suffix*64,
            "source_sha":"a"*40,
            **{name:receipt() for name in GATE.IMAGE_CHECKS},
        } for role,suffix in [("api","a"),("web","b"),("backup","c")]
    }
    previous={
        role:{
            "image_digest":"sha256:"+suffix*64,
            "source_sha":"b"*40,
            **{name:receipt() for name in GATE.IMAGE_CHECKS},
        } for role,suffix in [("api","d"),("web","e")]
    }
    return {
        "schema":"schoolos-v5-rollback-v2",
        "staging_project":GATE.PROJECT,
        "candidate_source_sha":"a"*40,
        "images":new_images,
        "rollback_source_sha":"b"*40,
        "rollback_images":previous,
        "rollback_app_data_compatibility":receipt(),
        "controls":{name:receipt() for name in GATE.REQUIRED},
        "phase2_release":receipt(),
        "rotation_window":receipt(),
    }

class Phase1RollbackGateTests(unittest.TestCase):
    def test_synthetic_complete_index_is_only_declaration(self):
        self.assertEqual(GATE.review(sample()),[])
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/"evidence-index.json"
            path.write_text(json.dumps(sample()))
            with contextlib.redirect_stdout(io.StringIO()) as captured:
                self.assertEqual(GATE.main(["--sanitized-index",str(path)]),0)
        out=captured.getvalue()
        self.assertIn("PASS_DECLARATIONS_ONLY",out)
        self.assertIn("DEPLOYMENT_AUTHORIZATION=HOLD",out)
        self.assertNotIn("a"*40,out)

    def test_legacy_v1_cannot_assert_previous_image_pair(self):
        x=sample()
        x["schema"]="schoolos-v5-rollback-v1"
        for key in ("rollback_source_sha","rollback_images",
                    "rollback_app_data_compatibility"):
            del x[key]
        self.assertEqual(GATE.review(x),["PRIOR_API_WEB_ROLLBACK_PAIR_NOT_INDEXED"])
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/"legacy-index.json"
            path.write_text(json.dumps(x))
            with contextlib.redirect_stdout(io.StringIO()) as captured:
                self.assertEqual(GATE.main(["--sanitized-index",str(path)]),2)
            self.assertIn("HOLD_INCOMPLETE",captured.getvalue())

    def test_missing_prior_pair_and_source_mismatch_fail_closed(self):
        x=sample()
        del x["rollback_images"]["web"]
        with self.assertRaises(GATE.InvalidEvidence):
            GATE.review(x)
        x=sample()
        x["rollback_images"]["api"]["source_sha"]="c"*40
        self.assertIn("PRIOR_SOURCE_MISMATCH_API",GATE.review(x))
        x=sample()
        x["rollback_source_sha"]=x["candidate_source_sha"]
        self.assertIn("PRIOR_AND_CANDIDATE_SOURCE_IDENTICAL",GATE.review(x))

    def test_reused_digest_and_unapproved_old_app_boot_cannot_pass(self):
        x=sample()
        x["rollback_images"]["api"]["image_digest"]=x["images"]["api"]["image_digest"]
        self.assertIn("IMAGE_DIGEST_REUSED_ACROSS_ROLES",GATE.review(x))
        x=sample()
        x["rollback_images"]["web"]["isolated_app_boot"]=receipt("PENDING")
        self.assertIn("PRIOR_IMAGE_WEB_ISOLATED_APP_BOOT",GATE.review(x))
        x=sample()
        x["rollback_app_data_compatibility"]=receipt("PENDING")
        self.assertIn("PRIOR_APP_DATA_COMPATIBILITY_NOT_APPROVED",GATE.review(x))

    def test_realistic_current_checkpoint_must_hold(self):
        x=sample()
        x["controls"]["archive_access_restricted"]=receipt("PENDING")
        x["controls"]["db_forward_backward_compatibility_reviewed"]=receipt("PENDING")
        x["images"]["web"]["source_to_image_attestation"]=receipt("PENDING")
        x["phase2_release"]=receipt("PENDING")
        x["rotation_window"]=receipt("PENDING")
        r=GATE.review(x)
        self.assertEqual(len(r),5)
        self.assertIn("IMAGE_WEB_SOURCE_TO_IMAGE_ATTESTATION",r)
        self.assertIn("PHASE2_RELEASE_NOT_APPROVED",r)
        self.assertIn("ROTATION_WINDOW_NOT_APPROVED",r)

    def test_unreviewed_layer_and_wrong_image_veto(self):
        x=sample()
        x["images"]["api"]["full_layer_audit"]=receipt("FAIL")
        x["images"]["backup"]["source_sha"]="c"*40
        self.assertIn("IMAGE_API_FULL_LAYER_AUDIT",GATE.review(x))
        self.assertIn("SOURCE_MISMATCH_BACKUP",GATE.review(x))

    def test_bad_evidence_reference_or_extra_field_is_refused(self):
        x=sample()
        x["controls"]["registry_pull_audience_reviewed"]["ref"]="../private/secret"
        with self.assertRaises(GATE.InvalidEvidence):
            GATE.review(x)
        x=sample()
        x["leaked_config"]={"POSTGRES_PASSWORD":"fake"}
        with self.assertRaises(GATE.InvalidEvidence):
            GATE.review(x)

    def test_input_failure_hides_private_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/"private.json"
            target.write_text("MY-SYNTHETIC-SUPER-SECRET")
            with contextlib.redirect_stdout(io.StringIO()) as cap:
                self.assertEqual(GATE.main(["--sanitized-index",str(target)]),2)
            self.assertIn("ROLLBACK_EVIDENCE_INDEX=CHECK_REQUIRED",cap.getvalue())
            self.assertNotIn("MY-SYNTHETIC",cap.getvalue())

if __name__=="__main__":
    unittest.main()
