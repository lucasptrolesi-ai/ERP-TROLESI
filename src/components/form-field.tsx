export function FormField({
  label,
  name,
  defaultValue,
  type = "text",
  required,
  maxLength,
  autoComplete,
  min,
  max,
  step,
  list,
  onChange,
  semCaixaAlta,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
  required?: boolean;
  maxLength?: number;
  autoComplete?: string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  list?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  // Opt-out pro raro campo type="text" que não deve virar maiúsculo (ex:
  // um código que precisa bater exatamente com algo externo). E-mail/data/
  // número/etc. já ficam de fora sozinhos, por não serem type="text".
  semCaixaAlta?: boolean;
}) {
  // Cadastro em caixa alta (pedido direto do usuário, 2026-07-25) — mesma
  // convenção que os dados reais do GMax já seguem (nomes, produtos,
  // endereços todos em maiúsculo). Só se aplica a campo de texto livre
  // (type="text", o default) — e-mail/data/número/senha já ficam de fora
  // por terem outro `type`, sem precisar listar exceção nenhuma.
  const aplicarCaixaAlta = type === "text" && !semCaixaAlta;

  function aoMudar(evento: React.ChangeEvent<HTMLInputElement>) {
    if (aplicarCaixaAlta) {
      const posicaoCursor = evento.target.selectionStart;
      evento.target.value = evento.target.value.toUpperCase();
      // Sem isso, setar .value manualmente jogaria o cursor pro fim do
      // campo a cada tecla — atrapalharia editar no meio de um nome longo.
      if (posicaoCursor !== null) evento.target.setSelectionRange(posicaoCursor, posicaoCursor);
    }
    onChange?.(evento);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-xs font-semibold uppercase tracking-wide text-text-soft">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue ?? undefined}
        required={required}
        maxLength={maxLength}
        autoComplete={autoComplete}
        min={min}
        max={max}
        step={step}
        list={list}
        onChange={aplicarCaixaAlta || onChange ? aoMudar : undefined}
        style={aplicarCaixaAlta ? { textTransform: "uppercase" } : undefined}
        className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
      />
    </div>
  );
}
