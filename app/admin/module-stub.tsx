import { CcIcon } from "./cc-chrome";

export default function ModuleStub({
  title,
  icon,
  desc,
}: {
  title: string;
  icon: string;
  desc: string;
}) {
  return (
    <main className="cc-container">
      <div className="cc-stub">
        <div className="cc-panel">
          <span className="cc-modicon" style={{ width: 56, height: 56 }}>
            <CcIcon name={icon} size={26} />
          </span>
          <h2>{title}</h2>
          <div className="pulse">● MODULE COMING ONLINE</div>
          <p>{desc}</p>
        </div>
      </div>
    </main>
  );
}
