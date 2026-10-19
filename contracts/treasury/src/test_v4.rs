#![cfg(test)]
//! v4: calendar-month budget, per-payee monthly caps, the deposit cap and task budgets.

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env, IntoVal,
};

// 2026-10-19T12:00:00Z — mid-month, so a test can stay inside October or step out of it.
const OCT_19: u64 = 1_792_411_200;
// 2026-11-01T00:00:00Z
const NOV_1: u64 = OCT_19 + 12 * 3_600 + 12 * 86_400;

struct T<'a> {
    env: &'a Env,
    admin: Address,
    agent: Address,
    token: TokenClient<'a>,
    token_admin: StellarAssetClient<'a>,
    client: TreasuryClient<'a>,
}

/// A treasury with roomy daily limits (so the monthly rules are what bind), funded with
/// 10_000 and holding `deposit_cap`. Needs `mock_all_auths` — the tests here are about the
/// policy, the auth tests further down set their own mocks.
fn world(env: &Env, deposit_cap: i128) -> T<'_> {
    env.ledger().set_timestamp(OCT_19);
    let admin = Address::generate(env);
    let agent = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = TokenClient::new(env, &sac.address());
    let token_admin = StellarAssetClient::new(env, &sac.address());
    let id = env.register(
        Treasury,
        (
            admin.clone(),
            agent.clone(),
            sac.address(),
            1_600_i128,
            100_i128,
            deposit_cap,
        ),
    );
    token_admin.mint(&id, &10_000_i128);
    T {
        env,
        admin,
        agent,
        token,
        token_admin,
        client: TreasuryClient::new(env, &id),
    }
}

fn approved(t: &T) -> Address {
    let p = Address::generate(t.env);
    t.client.add_payee(&p);
    p
}

fn next_day(env: &Env) {
    env.ledger().set_timestamp(env.ledger().timestamp() + 86_400 + 3_600);
}

// ---- the calendar ------------------------------------------------------------------

#[test]
fn month_of_follows_the_utc_calendar() {
    assert_eq!(month_of(0), 1970 * 12);
    assert_eq!(month_of(OCT_19), 2026 * 12 + 9);
    // leap day and the second after it
    assert_eq!(month_of(1_709_251_199), 2024 * 12 + 1);
    assert_eq!(month_of(1_709_251_200), 2024 * 12 + 2);
    // year boundary
    assert_eq!(month_of(1_798_761_599), 2026 * 12 + 11);
    assert_eq!(month_of(1_798_761_600), 2027 * 12);
    // 2100 is not a leap year: 1 March follows 28 February
    assert_eq!(month_of(4_107_542_400), 2100 * 12 + 2);
    assert_eq!(month_of(4_107_542_400 - 1), 2100 * 12 + 1);
    assert_eq!(month_of(NOV_1), 2026 * 12 + 10);
    assert_eq!(month_of(NOV_1 - 1), 2026 * 12 + 9);
}

#[test]
fn this_month_reads_the_ledger_clock() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    assert_eq!(t.client.this_month(), 2026 * 12 + 9);
    assert_eq!(t.client.version(), 4);
}

/// The new codes are part of the agent-facing vocabulary (MCP maps them by number) and 13
/// belongs to the token contract — pin them.
#[test]
fn v4_error_codes_are_stable() {
    assert_eq!(Error::ExceedsPayeeCap as u32, 14);
    assert_eq!(Error::ExceedsMonthlyLimit as u32, 15);
    assert_eq!(Error::ExceedsDepositCap as u32, 16);
    assert_eq!(Error::PayeeOutsideTaskBudget as u32, 17);
}

// ---- monthly limit -----------------------------------------------------------------

#[test]
fn monthly_limit_binds_across_days_and_frees_when_the_month_turns() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    let p = approved(&t);
    t.client.set_monthly_limit(&250);
    assert_eq!(t.client.monthly_limit(), 250);

    t.client.pay(&1, &p, &100);
    next_day(&env);
    t.client.pay(&2, &p, &100);
    next_day(&env);
    // 200 used; the daily window is empty again, so only the month refuses.
    assert_eq!(t.client.try_pay(&3, &p, &100), Err(Ok(Error::ExceedsMonthlyLimit)));
    t.client.pay(&4, &p, &50); // exactly at the limit
    assert_eq!(t.client.month_spent(&t.client.this_month()), 250);

    env.ledger().set_timestamp(NOV_1);
    t.client.pay(&5, &p, &100);
    assert_eq!(t.client.month_spent(&t.client.this_month()), 100);
}

#[test]
fn monthly_limit_zero_means_no_monthly_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    let p = approved(&t);
    t.client.set_monthly_limit(&100);
    t.client.pay(&1, &p, &100);
    next_day(&env);
    assert_eq!(t.client.try_pay(&2, &p, &1), Err(Ok(Error::ExceedsMonthlyLimit)));
    t.client.set_monthly_limit(&0);
    t.client.pay(&2, &p, &100);
}

/// The month is charged even with no limit set, so a limit added on the 20th counts the
/// 19th's spend instead of granting the agent a fresh month.
#[test]
fn a_limit_set_mid_month_counts_what_the_month_already_moved() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    let p = approved(&t);
    t.client.pay(&1, &p, &100);
    next_day(&env);
    t.client.set_monthly_limit(&150);
    assert_eq!(t.client.try_pay(&2, &p, &100), Err(Ok(Error::ExceedsMonthlyLimit)));
    t.client.pay(&2, &p, &50);
}

#[test]
fn escrow_commitments_count_against_the_month() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    let p = approved(&t);
    t.client.set_monthly_limit(&150);
    let deadline = env.ledger().timestamp() + 3_600;
    t.client.create_escrow(&1, &p, &100, &deadline);
    next_day(&env);
    assert_eq!(t.client.try_pay(&2, &p, &100), Err(Ok(Error::ExceedsMonthlyLimit)));
    assert_eq!(
        t.client.try_create_escrow(&3, &p, &100, &(env.ledger().timestamp() + 60)),
        Err(Ok(Error::ExceedsMonthlyLimit))
    );
}

#[test]
fn release_does_not_charge_the_month_twice() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    let p = approved(&t);
    t.client.set_monthly_limit(&200);
    let id = t.client.create_escrow(&1, &p, &100, &(env.ledger().timestamp() + 60));
    t.client.release_escrow(&id);
    assert_eq!(t.client.month_spent(&t.client.this_month()), 100);
    next_day(&env);
    t.client.pay(&2, &p, &100);
}

#[test]
fn monthly_limit_rejects_negative() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    assert_eq!(t.client.try_set_monthly_limit(&-1), Err(Ok(Error::InvalidLimits)));
}

// ---- per-payee cap -----------------------------------------------------------------

#[test]
fn payee_cap_binds_one_payee_and_leaves_the_others_alone() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    let capped = approved(&t);
    let other = approved(&t);
    t.client.set_payee_cap(&capped, &150);
    assert_eq!(t.client.payee_cap(&capped), 150);
    assert_eq!(t.client.payee_cap(&other), 0);

    t.client.pay(&1, &capped, &100);
    assert_eq!(t.client.try_pay(&2, &capped, &100), Err(Ok(Error::ExceedsPayeeCap)));
    t.client.pay(&3, &capped, &50);
    t.client.pay(&4, &other, &100);
    let m = t.client.this_month();
    assert_eq!(t.client.payee_spent(&capped, &m), 150);
    assert_eq!(t.client.payee_spent(&other, &m), 100);

    env.ledger().set_timestamp(NOV_1);
    t.client.pay(&5, &capped, &100);
}

#[test]
fn payee_cap_counts_escrow_commitments_and_zero_removes_it() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    let p = approved(&t);
    t.client.set_payee_cap(&p, &100);
    t.client.create_escrow(&1, &p, &80, &(env.ledger().timestamp() + 60));
    assert_eq!(t.client.try_pay(&2, &p, &30), Err(Ok(Error::ExceedsPayeeCap)));
    t.client.set_payee_cap(&p, &0);
    assert_eq!(t.client.payee_cap(&p), 0);
    t.client.pay(&2, &p, &30);
}

/// A cap narrows what an approved payee may receive; it is not an approval.
#[test]
fn payee_cap_does_not_approve_the_payee() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    let stranger = Address::generate(&env);
    t.client.set_payee_cap(&stranger, &1_000);
    assert_eq!(t.client.try_pay(&1, &stranger, &10), Err(Ok(Error::PayeeNotWhitelisted)));
}

/// The cap is checked before the treasury-wide month, so the agent hears the narrower reason.
#[test]
fn payee_cap_is_reported_before_the_monthly_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    let p = approved(&t);
    t.client.set_payee_cap(&p, &50);
    t.client.set_monthly_limit(&50);
    assert_eq!(t.client.try_pay(&1, &p, &60), Err(Ok(Error::ExceedsPayeeCap)));
}

#[test]
fn payee_cap_rejects_negative() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    let p = approved(&t);
    assert_eq!(t.client.try_set_payee_cap(&p, &-5), Err(Ok(Error::InvalidLimits)));
}

// ---- deposit cap -------------------------------------------------------------------

#[test]
fn deposit_refuses_to_take_the_balance_over_the_cap() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 12_000); // already holds 10_000
    let owner = Address::generate(&env);
    t.token_admin.mint(&owner, &5_000);

    t.client.deposit(&owner, &1_500);
    assert_eq!(t.client.balance(), 11_500);
    assert_eq!(t.client.try_deposit(&owner, &501), Err(Ok(Error::ExceedsDepositCap)));
    t.client.deposit(&owner, &500); // exactly at the cap
    assert_eq!(t.client.balance(), 12_000);
    assert_eq!(t.token.balance(&owner), 3_000);
    assert_eq!(t.client.deposit_cap(), 12_000);
}

/// Spending makes room again: the cap bounds what the treasury holds, not what it ever took in.
#[test]
fn spending_makes_room_under_the_deposit_cap() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 10_000);
    let owner = Address::generate(&env);
    t.token_admin.mint(&owner, &500);
    assert_eq!(t.client.try_deposit(&owner, &1), Err(Ok(Error::ExceedsDepositCap)));
    let p = approved(&t);
    t.client.pay(&1, &p, &100);
    t.client.deposit(&owner, &100);
}

#[test]
fn zero_deposit_cap_means_uncapped() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    let owner = Address::generate(&env);
    t.token_admin.mint(&owner, &1_000_000);
    t.client.deposit(&owner, &1_000_000);
    assert_eq!(t.client.balance(), 1_010_000);
}

#[test]
fn deposit_rejects_non_positive_amounts() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    let owner = Address::generate(&env);
    assert_eq!(t.client.try_deposit(&owner, &0), Err(Ok(Error::InvalidAmount)));
    assert_eq!(t.client.try_deposit(&owner, &-1), Err(Ok(Error::InvalidAmount)));
}

/// Nobody can deposit someone else's money: `from` signs.
#[test]
#[should_panic]
fn deposit_requires_the_depositor_signature() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    let victim = Address::generate(&env);
    t.token_admin.mint(&victim, &100);
    env.mock_auths(&[MockAuth {
        address: &t.agent,
        invoke: &MockAuthInvoke {
            contract: &t.client.address,
            fn_name: "deposit",
            args: (victim.clone(), 100_i128).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    t.client.deposit(&victim, &100);
}

#[test]
#[should_panic]
fn constructor_rejects_a_negative_deposit_cap() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    env.register(
        Treasury,
        (admin.clone(), admin, sac.address(), 1_000_i128, 100_i128, -1_i128),
    );
}

// ---- task budgets ------------------------------------------------------------------

#[test]
fn task_budget_pays_only_the_payees_it_names() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    let named = approved(&t);
    let other = approved(&t);
    let session_agent = Address::generate(&env);
    let until = env.ledger().timestamp() + 3_600;

    t.client
        .set_task_budget(&session_agent, &until, &300, &vec![&env, named.clone()]);
    assert_eq!(t.client.session_payees(), vec![&env, named.clone()]);

    t.client.pay(&1, &named, &100);
    assert_eq!(t.client.try_pay(&2, &other, &10), Err(Ok(Error::PayeeOutsideTaskBudget)));
    assert_eq!(
        t.client.try_create_escrow(&3, &other, &10, &(until + 60)),
        Err(Ok(Error::PayeeOutsideTaskBudget))
    );
    // The budget's own cap still applies.
    t.client.pay(&4, &named, &100);
    t.client.pay(&5, &named, &100);
    assert_eq!(t.client.try_pay(&6, &named, &1), Err(Ok(Error::ExceedsSessionLimit)));
}

/// Naming a payee in a budget does not approve it.
#[test]
fn task_budget_still_needs_approved_payees() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    let stranger = Address::generate(&env);
    let until = env.ledger().timestamp() + 3_600;
    t.client
        .set_task_budget(&Address::generate(&env), &until, &300, &vec![&env, stranger.clone()]);
    assert_eq!(t.client.try_pay(&1, &stranger, &10), Err(Ok(Error::PayeeNotWhitelisted)));
}

#[test]
fn a_plain_leash_or_revoke_clears_the_task_scope() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    let named = approved(&t);
    let other = approved(&t);
    let session_agent = Address::generate(&env);
    let until = env.ledger().timestamp() + 3_600;

    t.client
        .set_task_budget(&session_agent, &until, &300, &vec![&env, named.clone()]);
    t.client.set_session(&session_agent, &until, &300);
    assert_eq!(t.client.session_payees().len(), 0);
    t.client.pay(&1, &other, &10);

    t.client
        .set_task_budget(&session_agent, &until, &300, &vec![&env, named]);
    t.client.revoke_session();
    assert_eq!(t.client.session_payees().len(), 0);
    t.client.pay(&2, &other, &10); // root agent, no scope
}

/// When the budget expires, spending falls back to the root agent — which was never scoped.
#[test]
fn an_expired_task_budget_does_not_scope_the_root_agent() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    let named = approved(&t);
    let other = approved(&t);
    let until = env.ledger().timestamp() + 60;
    t.client
        .set_task_budget(&Address::generate(&env), &until, &300, &vec![&env, named]);
    env.ledger().set_timestamp(until);
    t.client.pay(&1, &other, &10);
}

#[test]
fn task_budget_rejects_an_empty_or_oversized_payee_list() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    let a = Address::generate(&env);
    let until = env.ledger().timestamp() + 60;
    assert_eq!(
        t.client.try_set_task_budget(&a, &until, &10, &soroban_sdk::Vec::new(&env)),
        Err(Ok(Error::InvalidLimits))
    );
    let mut many = soroban_sdk::Vec::new(&env);
    for _ in 0..(MAX_TASK_PAYEES + 1) {
        many.push_back(Address::generate(&env));
    }
    assert_eq!(
        t.client.try_set_task_budget(&a, &until, &10, &many),
        Err(Ok(Error::InvalidLimits))
    );
    // and the Leash rules still apply
    assert_eq!(
        t.client.try_set_task_budget(&a, &until, &0, &vec![&env, a.clone()]),
        Err(Ok(Error::InvalidLimits))
    );
}

// ---- admin-only setters ------------------------------------------------------------

fn only_agent_signs(t: &T, fn_name: &'static str, args: soroban_sdk::Vec<soroban_sdk::Val>) {
    t.env.mock_auths(&[MockAuth {
        address: &t.agent,
        invoke: &MockAuthInvoke {
            contract: &t.client.address,
            fn_name,
            args,
            sub_invokes: &[],
        },
    }]);
}

#[test]
#[should_panic]
fn set_monthly_limit_is_admin_only() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    only_agent_signs(&t, "set_monthly_limit", (0_i128,).into_val(&env));
    t.client.set_monthly_limit(&0);
}

#[test]
#[should_panic]
fn set_payee_cap_is_admin_only() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    let p = Address::generate(&env);
    only_agent_signs(&t, "set_payee_cap", (p.clone(), 0_i128).into_val(&env));
    t.client.set_payee_cap(&p, &0);
}

/// The agent cannot widen its own task scope.
#[test]
#[should_panic]
fn set_task_budget_is_admin_only() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    let until = env.ledger().timestamp() + 60;
    let payees = vec![&env, t.agent.clone()];
    only_agent_signs(
        &t,
        "set_task_budget",
        (t.agent.clone(), until, 10_i128, payees.clone()).into_val(&env),
    );
    t.client.set_task_budget(&t.agent, &until, &10, &payees);
}

/// What the admin signs is exactly what the contract asks for — one entry, no sub-calls.
#[test]
fn admin_signs_the_v4_setters() {
    let env = Env::default();
    env.mock_all_auths();
    let t = world(&env, 0);
    let p = Address::generate(&env);
    t.client.set_payee_cap(&p, &10);
    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, t.admin);
}
