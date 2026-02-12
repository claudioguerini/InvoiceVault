module invoice_vault::invoice_vault {
  const E_NOT_ISSUER: u64 = 1;
  const E_INVALID_STATUS: u64 = 2;
  const E_NOT_ALLOWED: u64 = 3;
  const E_INVALID_PRICE: u64 = 4;
  const E_INVALID_AMOUNT: u64 = 5;
  const E_INVALID_PAYMENT: u64 = 6;
  const E_SELF_FUNDING: u64 = 7;
  const E_NOT_HOLDER: u64 = 8;
  const E_INVALID_RATING: u64 = 9;
  const E_ALREADY_RATED: u64 = 10;
  const E_NOT_REPAID: u64 = 11;
  const E_NOT_SIMULATION: u64 = 12;
  const E_NOT_DUE_FOR_DEFAULT: u64 = 13;
  const PLATFORM_FEE_BPS: u64 = 75; // 0.75%
  const DEFAULT_FEE_BPS: u64 = 800; // 8.0%, 100% to holder in simulation mode.
  const DUE_OFFSET_SEC_SIMULATION: u64 = 30;
  const BPS_DENOMINATOR: u64 = 10000;
  const TREASURY_ADDRESS: address = @0x777a042ce80d4aaa59d69741775247f5131587e6654c7bc975bda804cd03b06b;

  const STATUS_OPEN: u8 = 0;
  const STATUS_FUNDED: u8 = 1;
  const STATUS_REPAID: u8 = 2;
  const STATUS_CANCELLED: u8 = 3;
  const STATUS_DEFAULTED: u8 = 4;
  const STATUS_RECOVERED: u8 = 5;

  public struct Invoice has key, store {
    id: UID,
    issuer: address,
    holder: address,
    invoice_hash: vector<u8>,
    amount: u64,
    due_date: u64,
    discount_price: u64,
    rating_score: u8,
    rated_by: address,
    auto_default_rating: bool,
    allowlist: vector<address>,
    denylist: vector<address>,
    status: u8,
    simulation_mode: bool,
    was_defaulted: bool,
    funded_at_ms: u64,
    defaulted_at_ms: u64,
    recovered_at_ms: u64
  }

  public struct InvoiceDefaulted has copy, drop {
    invoice_id: address,
    issuer: address,
    holder: address,
    due_date: u64,
    defaulted_at_ms: u64
  }

  public struct InvoiceRecovered has copy, drop {
    invoice_id: address,
    issuer: address,
    holder: address,
    repaid_amount: u64,
    default_fee: u64,
    recovered_at_ms: u64
  }

  /// create_invoice(hash, amount, due_date)
  public entry fun create_invoice(
    invoice_hash: vector<u8>,
    amount: u64,
    due_date: u64,
    ctx: &mut TxContext
  ) {
    create_invoice_internal(invoice_hash, amount, due_date, false, ctx);
  }

  /// create_invoice_simulation(hash, amount, due_date)
  /// Same as create_invoice, but enables demo default simulation logic.
  public entry fun create_invoice_simulation(
    invoice_hash: vector<u8>,
    amount: u64,
    due_date: u64,
    ctx: &mut TxContext
  ) {
    create_invoice_internal(invoice_hash, amount, due_date, true, ctx);
  }

  /// list_for_funding(discount_price)
  public entry fun list_for_funding(
    invoice: &mut Invoice,
    discount_price: u64,
    ctx: &TxContext
  ) {
    assert!(invoice.issuer == ctx.sender(), E_NOT_ISSUER);
    assert!(invoice.status == STATUS_OPEN, E_INVALID_STATUS);
    assert!(discount_price > 0, E_INVALID_PRICE);
    assert!(discount_price <= invoice.amount, E_INVALID_PRICE);
    invoice.discount_price = discount_price;
  }

  /// Optional compliance control for demo: set allowlist/denylist per invoice.
  public entry fun set_compliance_lists(
    invoice: &mut Invoice,
    allowlist: vector<address>,
    denylist: vector<address>,
    ctx: &TxContext
  ) {
    assert!(invoice.issuer == ctx.sender(), E_NOT_ISSUER);
    assert!(invoice.status == STATUS_OPEN, E_INVALID_STATUS);
    invoice.allowlist = allowlist;
    invoice.denylist = denylist;
  }

  /// cancel_invoice()
  /// Soft-delete on-chain for shared invoices.
  public entry fun cancel_invoice(invoice: &mut Invoice, ctx: &TxContext) {
    assert!(invoice.issuer == ctx.sender(), E_NOT_ISSUER);
    assert!(invoice.status == STATUS_OPEN, E_INVALID_STATUS);
    invoice.status = STATUS_CANCELLED;
    invoice.discount_price = 0;
  }

  /// fund_invoice()
  public entry fun fund_invoice(
    invoice: &mut Invoice,
    payment: iota::coin::Coin<iota::iota::IOTA>,
    clock: &iota::clock::Clock,
    ctx: &mut TxContext
  ) {
    assert!(invoice.status == STATUS_OPEN, E_INVALID_STATUS);
    assert!(invoice.discount_price > 0, E_INVALID_PRICE);
    assert!(is_allowed(invoice, ctx.sender()), E_NOT_ALLOWED);
    assert!(invoice.issuer != ctx.sender(), E_SELF_FUNDING);
    assert!(
      iota::coin::value(&payment) == invoice.discount_price,
      E_INVALID_PAYMENT
    );
    let mut payment_mut = payment;
    let fee_amount = (invoice.discount_price * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
    if (fee_amount > 0) {
      let fee_coin = iota::coin::split(&mut payment_mut, fee_amount, ctx);
      transfer::public_transfer(fee_coin, TREASURY_ADDRESS);
    };

    transfer::public_transfer(payment_mut, invoice.issuer);
    invoice.holder = ctx.sender();
    let now_ms = iota::clock::timestamp_ms(clock);
    invoice.funded_at_ms = now_ms;
    if (invoice.simulation_mode) {
      invoice.due_date = (now_ms / 1000) + DUE_OFFSET_SEC_SIMULATION;
    };
    invoice.status = STATUS_FUNDED;
  }

  /// repay_invoice()
  public entry fun repay_invoice(
    invoice: &mut Invoice,
    payment: iota::coin::Coin<iota::iota::IOTA>,
    clock: &iota::clock::Clock,
    ctx: &TxContext
  ) {
    assert!(invoice.issuer == ctx.sender(), E_NOT_ISSUER);

    let payment_amount = iota::coin::value(&payment);
    if (invoice.status == STATUS_FUNDED) {
      assert!(payment_amount == invoice.amount, E_INVALID_PAYMENT);
      transfer::public_transfer(payment, invoice.holder);
      invoice.status = STATUS_REPAID;
      return
    };

    if (invoice.status == STATUS_DEFAULTED) {
      assert!(invoice.simulation_mode, E_NOT_SIMULATION);
      let default_fee = default_fee_amount(invoice.amount);
      let required_amount = invoice.amount + default_fee;
      assert!(payment_amount == required_amount, E_INVALID_PAYMENT);
      transfer::public_transfer(payment, invoice.holder);
      invoice.status = STATUS_RECOVERED;
      invoice.recovered_at_ms = iota::clock::timestamp_ms(clock);
      iota::event::emit(InvoiceRecovered {
        invoice_id: object::id_address(invoice),
        issuer: invoice.issuer,
        holder: invoice.holder,
        repaid_amount: required_amount,
        default_fee,
        recovered_at_ms: invoice.recovered_at_ms
      });
      return
    };

    abort E_INVALID_STATUS
  }

  /// mark_defaulted()
  /// Buyer can mark default once simulation due date has passed.
  public entry fun mark_defaulted(
    invoice: &mut Invoice,
    clock: &iota::clock::Clock,
    ctx: &TxContext
  ) {
    assert!(invoice.simulation_mode, E_NOT_SIMULATION);
    assert!(invoice.holder == ctx.sender(), E_NOT_HOLDER);
    assert!(invoice.status == STATUS_FUNDED, E_INVALID_STATUS);

    let now_ms = iota::clock::timestamp_ms(clock);
    let now_sec = now_ms / 1000;
    assert!(now_sec > invoice.due_date, E_NOT_DUE_FOR_DEFAULT);

    invoice.status = STATUS_DEFAULTED;
    invoice.was_defaulted = true;
    invoice.defaulted_at_ms = now_ms;
    // Auto-feedback for default event: initial score 1/5, set by holder.
    invoice.rating_score = 1;
    invoice.rated_by = ctx.sender();
    invoice.auto_default_rating = true;
    iota::event::emit(InvoiceDefaulted {
      invoice_id: object::id_address(invoice),
      issuer: invoice.issuer,
      holder: invoice.holder,
      due_date: invoice.due_date,
      defaulted_at_ms: now_ms
    });
  }

  /// Default fee (simulation mode only), 100% transferred to holder on recovery.
  fun default_fee_amount(amount: u64): u64 {
    (amount * DEFAULT_FEE_BPS) / BPS_DENOMINATOR
  }

  fun create_invoice_internal(
    invoice_hash: vector<u8>,
    amount: u64,
    due_date: u64,
    simulation_mode: bool,
    ctx: &mut TxContext
  ) {
    assert!(amount > 0, E_INVALID_AMOUNT);
    assert!(due_date > 0, E_INVALID_AMOUNT);

    let invoice = Invoice {
      id: object::new(ctx),
      issuer: ctx.sender(),
      holder: @0x0,
      invoice_hash,
      amount,
      due_date,
      discount_price: 0,
      rating_score: 0,
      rated_by: @0x0,
      auto_default_rating: false,
      allowlist: vector[],
      denylist: vector[],
      status: STATUS_OPEN,
      simulation_mode,
      was_defaulted: false,
      funded_at_ms: 0,
      defaulted_at_ms: 0,
      recovered_at_ms: 0
    };

    transfer::share_object(invoice);
  }

  /// rate_invoice(score)
  /// Buyer -> issuer rating after successful repayment.
  /// If invoice was auto-rated on default (1/5), buyer can override once after recovery.
  public entry fun rate_invoice(invoice: &mut Invoice, score: u8, ctx: &TxContext) {
    assert!(invoice.holder == ctx.sender(), E_NOT_HOLDER);
    assert!(
      invoice.status == STATUS_REPAID || invoice.status == STATUS_RECOVERED,
      E_NOT_REPAID
    );
    if (invoice.rating_score != 0) {
      assert!(
        invoice.status == STATUS_RECOVERED && invoice.auto_default_rating,
        E_ALREADY_RATED
      );
    };
    assert!(score >= 1 && score <= 5, E_INVALID_RATING);
    invoice.rating_score = score;
    invoice.rated_by = ctx.sender();
    invoice.auto_default_rating = false;
  }

  fun is_allowed(invoice: &Invoice, buyer: address): bool {
    let blocked = vector::contains(&invoice.denylist, &buyer);
    if (blocked) {
      return false
    };

    let allowlist_len = vector::length(&invoice.allowlist);
    if (allowlist_len == 0) {
      return true
    };

    vector::contains(&invoice.allowlist, &buyer)
  }
}
